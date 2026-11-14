"""The content lint's extractors: each turns one file type into segments.

Split from cs_site_lint.py, which imports every name here.
"""

import json
import re
import sys
from html.parser import HTMLParser

from cs_site_lint_rules import InfraError

# A task-list box ("- [ ]", "* [x]") is Markdown syntax that decision 87 asks
# docs for, not text. extract_markdown blanks it, so the placeholder rule,
# whose regex the LinkedIn gate shares (C2), never reads it as a slot (#554).
TASK_BOX_RE = re.compile(r"^(\s*[-*+]\s+)\[[ xX]\]")


# --------------------------------------------------------------------------
# Extraction. Each extractor returns segments: (line_no, text, owner_key).
# owner_key is the YAML key that owns a value, or None for body text.

NON_STRING_RE = re.compile(
    r"^(?:true|false|yes|no|on|off|null|~|[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?|0x[0-9a-f]+"
    r"|\d{4}-\d{2}-\d{2}(?:[t ][0-9:.]+(?:z|[-+]\d{2}:?\d{2})?)?)$",
    re.IGNORECASE)
KEY_RE = re.compile(
    r"""^(?P<key>[A-Za-z0-9_][A-Za-z0-9_.\-]*|"[^"]*"|'[^']*')\s*:(?:\s+(?P<value>.*))?$""")
BLOCK_RE = re.compile(r"^[|>][-+0-9]*$")


def _strip_comment(value):
    """Drop a trailing ' # comment' from a plain (unquoted) scalar."""
    m = re.search(r"\s#", value)
    return value[:m.start()] if m else value


def _scan_quoted(text, q, start):
    """Read a quoted scalar body from text[start:]. Returns (inner, closed)."""
    out = []
    i = start
    while i < len(text):
        c = text[i]
        if q == '"' and c == "\\" and i + 1 < len(text):
            out.append(text[i:i + 2])
            i += 2
            continue
        if c == q:
            if q == "'" and text[i + 1:i + 2] == "'":
                out.append("'")
                i += 2
                continue
            return "".join(out), True
        out.append(c)
        i += 1
    return "".join(out), False


def _scalar_text(value):
    """Return the string content of a one-line plain YAML scalar, or None."""
    value = _strip_comment(value).strip()
    if not value:
        return None
    if value[:1] in ("&", "*", "!"):
        # anchors, aliases and tags: drop the token, keep what follows
        parts = value.split(None, 1)
        value = parts[1] if len(parts) > 1 else ""
        if not value:
            return None
    if value[:1] in ("[", "{") and value[-1:] in ("]", "}"):
        return value[1:-1].strip() or None
    if NON_STRING_RE.match(value):
        return None
    return value


def extract_yaml(lines, first_line_no=1):
    """Pull string values out of YAML lines, with the key that owns each one.

    A line-oriented reader, not a full YAML parser (standard library only).
    It handles mappings, lists, block scalars (| and >), quoted and plain
    multi-line scalars, comments and flow lists. Anything it misreads errs
    toward linting more text, never less.
    """
    segs = []
    stack = []  # (indent, key)
    block = None  # (indent_of_owner, owner_key)
    quoted = None  # (quote_char, owner_key)
    for offset, raw in enumerate(lines):
        no = first_line_no + offset
        line = raw.rstrip("\r\n")
        stripped = line.strip()
        indent = len(line) - len(line.lstrip(" "))

        if block is not None:
            if not stripped or indent > block[0]:
                if stripped:
                    segs.append((no, stripped, block[1]))
                continue
            block = None
        if quoted is not None:
            q, owner = quoted
            inner, closed = _scan_quoted(stripped, q, 0)
            if inner.strip():
                segs.append((no, inner, owner))
            if closed:
                quoted = None
            continue

        if not stripped or stripped.startswith("#") or stripped in ("---", "..."):
            continue

        rest = stripped
        eff = indent
        while rest == "-" or rest.startswith("- "):
            eff += 2
            rest = rest[1:].lstrip(" ")
        if not rest:
            continue

        m = KEY_RE.match(rest)
        if m:
            key = m.group("key").strip("\"'")
            while stack and stack[-1][0] >= eff:
                stack.pop()
            stack.append((eff, key))
            owner = key
            value = (m.group("value") or "").strip()
        else:
            while stack and stack[-1][0] > eff:
                stack.pop()
            owner = stack[-1][1] if stack else None
            value = rest

        if not value:
            continue
        if value[:1] in ('"', "'"):
            inner, closed = _scan_quoted(value, value[0], 1)
            if inner.strip():
                segs.append((no, inner, owner))
            if not closed:
                quoted = (value[0], owner)
            continue
        bare = _strip_comment(value).strip()
        if BLOCK_RE.match(bare):
            block = (eff, owner)
            continue
        text = _scalar_text(bare)
        if text:
            segs.append((no, text, owner))
    return segs


def extract_markdown(text):
    """Front matter string values (through the YAML reader), then body lines."""
    lines = text.splitlines()
    segs = []
    start = 0
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() in ("---", "..."):
                segs.extend(extract_yaml(lines[1:i], first_line_no=2))
                start = i + 1
                break
    for i in range(start, len(lines)):
        segs.append((i + 1, TASK_BOX_RE.sub(r"\1   ", lines[i]), None))
    return segs


def extract_plain(text):
    return [(i + 1, line, None) for i, line in enumerate(text.splitlines())]


BLOCK_TAGS = {
    "address", "article", "aside", "blockquote", "br", "button", "caption", "dd",
    "details", "dialog", "div", "dl", "dt", "fieldset", "figcaption", "figure",
    "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "label",
    "legend", "li", "main", "nav", "ol", "option", "p", "pre", "section", "summary",
    "table", "td", "th", "title", "tr", "ul", "body", "head", "html",
}
TEXT_ATTRS = ("alt", "title", "aria-label")


class _VisibleText(HTMLParser):
    """Visible text, one virtual line per block, mapped back to source lines."""

    def __init__(self, skip_tags):
        HTMLParser.__init__(self, convert_charrefs=True)
        self.skip_tags = skip_tags
        self.skip_depth = 0
        self.buf = []
        self.buf_line = None
        self.blocks = []  # (source_line, text)
        self.attr_texts = []  # (source_line, attribute name, value)
        self.links = []  # (source_line, href or src value)

    def _links(self, attrs):
        # Link targets are not visible text, but a link rule (coloradoai.us,
        # a local path) must still see a URL a template hardcodes. They go in
        # as 'href' segments, so only scan_skipped_keys rules read them.
        # alt, title and aria-label are read aloud or shown on hover, so they
        # go in as plain text, each its own segment (#808 review).
        if self.skip_depth:
            return
        for name, value in attrs:
            if name in ("href", "src") and value:
                self.links.append((self.getpos()[0], value))
            elif name in TEXT_ATTRS and value and value.strip():
                self.attr_texts.append((self.getpos()[0], name, " ".join(value.split())))

    def _flush(self):
        text = " ".join("".join(self.buf).split())
        if text:
            self.blocks.append((self.buf_line, text))
        self.buf = []
        self.buf_line = None

    def handle_starttag(self, tag, attrs):
        if tag in self.skip_tags:
            self.skip_depth += 1
            return
        self._links(attrs)
        if tag in BLOCK_TAGS:
            self._flush()

    def handle_startendtag(self, tag, attrs):
        self._links(attrs)
        if tag in BLOCK_TAGS:
            self._flush()

    def handle_endtag(self, tag):
        if tag in self.skip_tags:
            self.skip_depth = max(0, self.skip_depth - 1)
        elif tag in BLOCK_TAGS:
            self._flush()

    def handle_data(self, data):
        if self.skip_depth:
            return
        if self.buf_line is None and data.strip():
            self.buf_line = self.getpos()[0]
        self.buf.append(data)

    def close(self):
        HTMLParser.close(self)
        self._flush()


def extract_html(text, skip_tags):
    parser = _VisibleText(skip_tags)
    parser.feed(text)
    parser.close()
    # Virtual line numbers keep blocks apart for sentence checks; the source
    # line is restored when findings are reported.
    segs = []
    line_map = {}
    for i, (src_line, block) in enumerate(parser.blocks, start=1):
        segs.append((i, block, None))
        line_map[i] = (src_line, block)
    offset = len(parser.blocks)
    for j, (src_line, name, value) in enumerate(parser.attr_texts, start=1):
        segs.append((offset + j, value, None))
        line_map[offset + j] = (src_line, '%s="%s"' % (name, value))
    offset += len(parser.attr_texts)
    for j, (src_line, target) in enumerate(parser.links, start=1):
        segs.append((offset + j, target, "href"))
        line_map[offset + j] = (src_line, "href=" + target)
    return segs, line_map


def extract_json(text):
    """String values of a JSON document, each with the key that owns it.

    A list item belongs to the key that holds the list. Each value gets its
    own virtual line, with whitespace collapsed, so an embedded newline cannot
    shift voice_lint's line numbers and no sentence check runs across two
    values. Returns (segs, where), where[line] = (JSON path, raw value).
    Raises InfraError when the text is not JSON, or nests deeper than the
    Python recursion limit: could not check, never a FAIL.
    """
    try:
        data = json.loads(text)
    except RecursionError:
        raise InfraError("JSON nests too deep to parse") from None
    except ValueError as exc:
        raise InfraError("not valid JSON (%s)" % exc)
    segs = []
    where = {}

    def walk(value, owner, path):
        if isinstance(value, dict):
            for key, child in value.items():
                walk(child, key, "%s.%s" % (path, key))
        elif isinstance(value, list):
            for i, child in enumerate(value):
                walk(child, owner, "%s[%d]" % (path, i))
        elif isinstance(value, str) and value.strip():
            no = len(segs) + 1
            segs.append((no, " ".join(value.split()), owner))
            where[no] = (path, value)

    try:
        walk(data, None, "$")
    except RecursionError:
        # walk() recurses once per level. A document deeper than the limit
        # was not read, so it is could-not-check, never a FAIL.
        raise InfraError("JSON nests deeper than the recursion limit (%d); not walked"
                         % sys.getrecursionlimit()) from None
    return segs, where


def _json_source_line(text, value):
    """The source line a string value sits on, for the report; 1 if not found."""
    at = text.find(json.dumps(value, ensure_ascii=False)[1:-1])
    return text.count("\n", 0, at) + 1 if at >= 0 else 1
