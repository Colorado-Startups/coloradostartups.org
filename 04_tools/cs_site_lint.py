#!/usr/bin/env python3
"""cs_site_lint.py: the coloradostartups.org content gate.

One definition, many call sites. Every call site shells out to this file and
none carries its own copy of a rule:

  1. .claude/hooks/cs-site-content-guard.sh, wired in .claude/settings.json
     under PostToolUse (matcher Write|Edit). Fires on every edit. Advisory:
     the write already happened, so exit 2 there only shows Claude the
     findings.
  2. .githooks/pre-commit and .githooks/pre-push, through
     .githooks/cs-site-route.sh. Fire on commit and push. Blocking.
  3. .github/workflows/content-gates.yml (changed files) and
     .github/workflows/site-tests.yml (npm run lint:built). Advisory. Both
     run through 04_tools/ci_gate.sh, which turns exit 3 into a warning.

.claude/settings.json is the authority on what is wired, not this comment.
contract_test.py C5 checks the gate table in .claude/rules/site-gates.md against it.

Rules live in cs_site_rules.json, plus the private avoid list in
cs_site_rules.private.json when that file is present (CS_SITE_PRIVATE_RULES
names another path). The private file never leaves the archive repo; without
it the lint runs the public rules and says so on stderr (#552). Generic prose rules (em dash, spaced en
dash, hedges, AI tells, sentence length, unattributed figures) come from
voice_lint.py in this folder, vendored verbatim from SoulCraft-Org/git-crafter
tools/voice_lint.py (its first lines name the commit).
The site's term rules run here, on the raw extracted text, because
voice_lint replaces URLs before its own patterns run and compiles every
pattern case-insensitive.

What gets read:
  data/**/*.md       Markdown body, plus front matter string values.
  data/**/*.y(a)ml   String values only. Keys in extract.skip_keys (url,
                     website, id, slug, image, href) are skipped, except by
                     rules that set scan_skipped_keys.
  art/**/*.md|txt    Art prompts, as plain text.
  --built DIR        Every file under DIR whose type scope.built lists:
                     .html  visible text (script, style and template are
                            skipped), plus href and src values, which only the
                            scan_skipped_keys link rules read.
                     .txt   every line, as plain text (robots.txt, llms.txt).
                     .json  string values only, each with the key that owns
                            it, so skip_keys work as they do in YAML.
Anything else is skipped silently. Code (.astro, .ts, .js) is never linted.

Usage:
  python3 04_tools/cs_site_lint.py FILE [FILE ...]
  python3 04_tools/cs_site_lint.py                   every in-scope file
  python3 04_tools/cs_site_lint.py --built site/dist
  python3 04_tools/cs_site_lint.py --self-test
Options: --root DIR (repo root; default: the folder above 04_tools),
         --rules PATH, --today YYYY-MM-DD (date windows), --quiet.

Exit codes:
  0  clean (warnings allowed)
  1  at least one FAIL
  2  usage error
  3  could not check: voice_lint.py missing, rules file unreadable or
     invalid, an in-scope file unreadable, --built directory absent, a
     built .json file that does not parse or nests too deep to walk.
     Callers treat 3 as "could not verify", never as a content violation.
A real FAIL still exits 1 when something else could not be checked.

Python 3.9 or later, standard library only.
"""

import argparse
import datetime
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
from html.parser import HTMLParser

# No __pycache__ in the repo: these tools run from hooks on every commit.
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.dirname(HERE)
DEFAULT_RULES = os.path.join(HERE, "cs_site_rules.json")
DEFAULT_PRIVATE_RULES = os.path.join(HERE, "cs_site_rules.private.json")
PRIVATE_RULES_ENV = "CS_SITE_PRIVATE_RULES"
# While this marker sits beside the overlay (the archive repo), the overlay
# must load whole: a missing or short overlay is could-not-check (exit 3).
MARKER_NAME = ".private-overlay-required"
DEFAULT_MARKER = os.path.join(HERE, MARKER_NAME)
VOICE_LINT = os.path.join(HERE, "voice_lint.py")

EXIT_OK = 0
EXIT_FAIL = 1
EXIT_USAGE = 2
EXIT_INFRA = 3

SEVERITIES = ("FAIL", "WARN", "off")
# File types --built can read; scope.built in the rules file picks among them.
BUILT_TYPES = (".html", ".json", ".txt")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
# A task-list box ("- [ ]", "* [x]") is Markdown syntax that decision 87 asks
# docs for, not text. extract_markdown blanks it, so the placeholder rule,
# whose regex the LinkedIn gate shares (C2), never reads it as a slot (#554).
TASK_BOX_RE = re.compile(r"^(\s*[-*+]\s+)\[[ xX]\]")
PRUNE_DIRS = {".git", "node_modules", ".astro", ".wrangler", "dist", "__pycache__", "local"}

# A date inside every rule window, so the sample run sees every rule at its
# base severity. Window edges are tested separately.
SELF_TEST_TODAY = datetime.date(2026, 10, 8)


class InfraError(Exception):
    """Could not verify. Never reported as a content violation."""


class UsageError(Exception):
    """Bad command line input."""


# --------------------------------------------------------------------------
# Rules file


def glob_to_regex(pattern):
    """Translate a path glob with ** into an anchored regex."""
    out = []
    i = 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif pattern[i] == "*":
            out.append("[^/]*")
            i += 1
        elif pattern[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    return re.compile("^" + "".join(out) + "$")


def glob_match(pattern, rel):
    return bool(glob_to_regex(pattern).match(rel))


def parse_date(text, what="date"):
    try:
        return datetime.datetime.strptime(str(text), "%Y-%m-%d").date()
    except ValueError:
        raise InfraError("bad %s %r (want YYYY-MM-DD)" % (what, text))


def check_severity(value, where):
    if value not in SEVERITIES:
        raise InfraError("%s: severity %r must be FAIL, WARN or off" % (where, value))
    return value


class Config(object):
    """The rules file, validated and compiled."""

    def __init__(self, data, path):
        self.path = path
        try:
            self._build(data)
        except InfraError:
            raise
        except (KeyError, TypeError, AttributeError, ValueError, re.error) as exc:
            raise InfraError("rules file %s is malformed (%s: %s)"
                             % (path, type(exc).__name__, exc))

    def _build(self, data):
        scope = data["scope"]
        self.content_globs = list(scope["content"])
        self.built_globs = list(scope["built"])
        # --built reads the file types scope.built names. A type with no
        # extractor is a rules-file error, never a silent skip.
        self.built_suffixes = tuple(sorted(set(os.path.splitext(g)[1] for g in self.built_globs)))
        unknown = [s or "(none)" for s in self.built_suffixes if s not in BUILT_TYPES]
        if unknown:
            raise InfraError("scope.built names file types the lint cannot read: %s (it reads %s)"
                             % (", ".join(unknown), ", ".join(BUILT_TYPES)))
        self.never_globs = list(scope.get("never", []))
        extract = data["extract"]
        self.skip_keys = set(k.lower() for k in extract["skip_keys"])
        self.html_skip_tags = set(t.lower() for t in extract["html_skip_tags"])
        self.vl_rules = dict(data["voice_lint"]["rules"])
        self.rules = []
        seen = set()
        for spec in data["rules"]:
            rid = spec["id"]
            if rid in seen:
                raise InfraError("duplicate rule id %r" % rid)
            seen.add(rid)
            check_severity(spec["severity"], rid)
            if "severity_built" in spec:
                check_severity(spec["severity_built"], rid + " severity_built")
            window = spec.get("window")
            if window is not None:
                keys = set(window)
                if len(keys) != 1 or not keys <= {"until", "through"}:
                    raise InfraError("rule %s: window needs exactly one of 'until' or 'through'" % rid)
                parse_date(list(window.values())[0], "window date in rule %s" % rid)
            if "after_expiry" in spec:
                if window is None:
                    raise InfraError("rule %s: after_expiry without a window" % rid)
                check_severity(spec["after_expiry"], rid + " after_expiry")
            for key in ("paths", "fields", "built_types", "built_skip_tags"):
                if key in spec and not (isinstance(spec[key], list)
                                        and all(isinstance(p, str) for p in spec[key])):
                    raise InfraError("rule %s: %s must be a list of strings" % (rid, key))
            unread = [t for t in spec.get("built_types", []) if t not in BUILT_TYPES]
            if unread:
                raise InfraError("rule %s: built_types names %s (the lint reads %s)"
                                 % (rid, ", ".join(unread), ", ".join(BUILT_TYPES)))
            flags = 0 if spec.get("case_sensitive") else re.IGNORECASE
            rule = dict(spec)
            rule["re"] = re.compile(spec["regex"], flags)
            rule["exempt_re"] = re.compile(spec["exempt_match"], flags) if "exempt_match" in spec else None
            rule["fields_set"] = set(f.lower() for f in spec.get("fields", []))
            self.rules.append(rule)

    def is_never(self, rel):
        return any(glob_match(g, rel) for g in self.never_globs)

    def in_content_scope(self, rel):
        if self.is_never(rel):
            return False
        return any(glob_match(g, rel) for g in self.content_globs)


def _read_json_object(path, what):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, UnicodeDecodeError) as exc:
        raise InfraError("cannot read %s %s (%s)" % (what, path, exc))
    except ValueError as exc:
        raise InfraError("%s %s is not valid JSON (%s)" % (what, path, exc))
    if not isinstance(data, dict):
        raise InfraError("%s %s must hold a JSON object" % (what, path))
    return data


def private_rules_path(env=None, default=None):
    """The private overlay's path, and whether the caller named it.

    A path named in CS_SITE_PRIVATE_RULES must exist; the variable set but
    empty is an error. The default path may be absent: that is the public
    repo, which runs on the public rules alone.
    """
    env = os.environ if env is None else env
    if PRIVATE_RULES_ENV in env:
        if not env[PRIVATE_RULES_ENV]:
            raise InfraError("%s is set but empty; unset it or name the overlay" % PRIVATE_RULES_ENV)
        return env[PRIVATE_RULES_ENV], True
    return default or DEFAULT_PRIVATE_RULES, False


def private_marker(overlay_path, named, marker=None):
    """The required-overlay marker as a dict, or None when there is none.

    It is looked for beside the lint (the archive repo) and, for a named
    overlay, beside that overlay.
    """
    places = [marker or DEFAULT_MARKER]
    if named:
        places.append(os.path.join(os.path.dirname(os.path.abspath(overlay_path)), MARKER_NAME))
    found = next((p for p in places if os.path.exists(p)), None)
    if found is None:
        return None
    data = _read_json_object(found, "private overlay marker")
    for key in ("min_rules", "min_shared_ids"):
        if not isinstance(data.get(key), int) or data[key] < 1:
            raise InfraError("private overlay marker %s needs a positive %s" % (found, key))
    req = data.get("required_ids", [])
    if not isinstance(req, list) or not all(isinstance(i, str) for i in req):
        raise InfraError("private overlay marker %s: required_ids must be a list of strings" % found)
    if not isinstance(data.get("expected_windows", {}), dict):
        raise InfraError("private overlay marker %s: expected_windows must be an object" % found)
    data["_path"] = found
    return data


def overlay_shortfall(overlay, mark):
    """What the overlay lacks against the marker, as text; empty when whole.

    Counts unique rule ids and unique shared ids, so copies of one rule never
    meet the floor, and names each required id that is missing (#667).
    One definition: contract_test.py C11 and termRuleIds() check the same.
    """
    ids = set(r.get("id") for r in overlay.get("rules", []) if isinstance(r, dict))
    shared = set(overlay.get("shared_ids", []))
    short = ["%d unique %s, want at least %d" % (n, what, mark[key])
             for what, n, key in (("rule ids", len(ids), "min_rules"), ("shared ids", len(shared), "min_shared_ids"))
             if n < mark[key]]
    missing = sorted(set(mark.get("required_ids", [])) - ids)
    if missing:
        short.append("required ids missing: %s" % ", ".join(missing))
    return short


def load_rules_data(path=None, env=None, default_private=None, marker=None, enforce=True):
    """The rules file with the private overlay merged in.

    Returns (data, overlay_path), where overlay_path is None when no overlay
    was found. Overlay rules join data["rules"] and its shared_ids join
    shared_from.ids. With the marker present the overlay must load with the
    marker's minimum counts, or InfraError; enforce=False lets
    contract_test.py C11 report that as a FAIL instead. data["private_marker"]
    holds the marker and data["private_windows"] its windows, for C7 and C11.
    One definition: the contract test calls this too.
    """
    data = dict(_read_json_object(path or DEFAULT_RULES, "rules file"))
    overlay_path, named = private_rules_path(env, default_private)
    if os.path.exists(overlay_path) and not os.path.isfile(overlay_path):
        raise InfraError("the private rules overlay %s is not a file" % overlay_path)
    mark = private_marker(overlay_path, named, marker)
    data["private_marker"] = mark
    data["private_windows"] = dict((mark or {}).get("expected_windows", {}))
    if not os.path.isfile(overlay_path):
        if named:
            raise InfraError("%s names %s, which does not exist" % (PRIVATE_RULES_ENV, overlay_path))
        if mark and enforce:
            raise InfraError("%s requires the private rules overlay, and %s is missing" % (mark["_path"], overlay_path))
        return data, None
    overlay = _read_json_object(overlay_path, "private rules file")
    if not isinstance(overlay.get("rules"), list) or not overlay["rules"]:
        raise InfraError("private rules file %s has no rules: an empty overlay is never meant" % overlay_path)
    if not isinstance(overlay.get("shared_ids", []), list):
        raise InfraError("private rules file %s: shared_ids must be a list" % overlay_path)
    if mark and enforce:
        short = overlay_shortfall(overlay, mark)
        if short:
            raise InfraError("private rules overlay %s is short of %s: %s" % (overlay_path, mark["_path"], "; ".join(short)))
    data["rules"] = list(data["rules"]) + overlay["rules"]
    shared = dict(data.get("shared_from") or {})
    shared["ids"] = list(shared.get("ids", [])) + list(overlay.get("shared_ids", []))
    if overlay.get("linkedin_rules_path"):
        shared["path"] = overlay["linkedin_rules_path"]
    data["shared_from"] = shared
    return data, overlay_path


def load_config(path=None, env=None, default_private=None, marker=None):
    data, overlay_path = load_rules_data(path, env, default_private, marker)
    cfg = Config(data, path or DEFAULT_RULES)
    cfg.private_path = overlay_path
    return cfg


def window_expired(window, today):
    if not window:
        return False
    if "until" in window:
        return today >= parse_date(window["until"])
    return today > parse_date(window["through"])


def effective_severity(rule, today, built=False):
    """Severity on this date and in this mode, after the rule's window. None means off.

    In --built mode a rule's severity_built, when set, replaces its severity:
    a page that ships is held harder than a draft (#808).
    """
    sev = rule.get("severity_built", rule["severity"]) if built else rule["severity"]
    if window_expired(rule.get("window"), today):
        sev = rule.get("after_expiry", "off")
    return None if sev == "off" else sev


def rule_applies_to(rule, rel, built):
    """Path filter. A rule without 'paths' runs everywhere in scope.

    In --built mode a path-limited rule runs only when it sets built: true,
    because the HTML path (site/dist/...) never matches a data/ glob. A rule
    with built_types reads only those built file types.
    """
    if built and rule.get("built_types") and not rel.endswith(tuple(rule["built_types"])):
        return False
    paths = rule.get("paths")
    if not paths:
        return True
    if built:
        return bool(rule.get("built"))
    return any(glob_match(p, rel) for p in paths)


def rule_matches(rule, text):
    """The rule's matches in text, less those its exempt_match covers whole.

    exempt_match keeps a shared regex the same as the LinkedIn file's while the
    site lets one form through: placeholder's bare "[1]" citation (#808 review).
    """
    exempt = rule.get("exempt_re")
    for m in rule["re"].finditer(text):
        if not (exempt and exempt.fullmatch(m.group(0).strip())):
            yield m


# --------------------------------------------------------------------------
# voice_lint


def load_voice_lint(cfg, path=VOICE_LINT):
    """Return ((module, rules), None), or (None, reason) when it cannot load."""
    if not os.path.isfile(path):
        return None, "voice_lint.py not found at %s; generic prose rules did not run" % path
    try:
        spec = importlib.util.spec_from_file_location("cs_site_voice_lint", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        for name in ("lint_text", "load_rules_from_obj"):
            if not callable(getattr(mod, name, None)):
                return None, "voice_lint.py has no %s(); its API changed" % name
        clean = {k: v for k, v in cfg.vl_rules.items() if not k.startswith("_")}
        rules = mod.load_rules_from_obj(clean)
    except Exception as exc:  # any import or rules failure is infrastructure
        return None, "voice_lint.py could not load (%s: %s)" % (type(exc).__name__, exc)
    return (mod, rules), None


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


# --------------------------------------------------------------------------
# Linting


def lint_segments(cfg, vl, segs, rel, today, built=False, rules=None):
    """Run voice_lint and the term rules (all of them, or rules) over extracted segments.

    Returns a list of (line_no, severity, check_id, message).
    """
    findings = []

    # Generic prose rules, on everything a reader sees.
    if vl is not None and segs:
        mod, vrules = vl
        last = max(no for no, _, _ in segs)
        masked = [""] * last
        for no, text, owner in segs:
            if owner is not None and owner.lower() in cfg.skip_keys:
                continue
            masked[no - 1] = (masked[no - 1] + " " + text) if masked[no - 1] else text
        for line_no, sev, check, message in mod.lint_text("\n".join(masked), vrules):
            findings.append((line_no, sev, check, message))

    # Term rules, on the raw text.
    for rule in cfg.rules if rules is None else rules:
        sev = effective_severity(rule, today, built)
        if not sev or not rule_applies_to(rule, rel, built):
            continue
        prev = None  # (line_no, text, owner) of the last segment this rule read
        for no, text, owner in segs:
            okey = owner.lower() if owner is not None else None
            if rule["fields_set"] and okey not in rule["fields_set"]:
                prev = None
                continue
            if okey in cfg.skip_keys and not rule.get("scan_skipped_keys"):
                prev = None
                continue
            if owner is None and FENCE_RE.match(text):
                prev = None
                continue
            m = next(rule_matches(rule, text), None)
            if m:
                findings.append((no, sev, rule["id"],
                                 '"%s" (%s)' % (m.group(0).strip(), rule["message"])))
            elif (not built and prev is not None and prev[0] == no - 1
                  and prev[2] == owner and prev[1].strip() and text.strip()):
                # A phrase wrapped across two lines ("Silicon" / "Valley of").
                # Only a match that spans the joint counts; a match inside
                # one line was already reported on that line.
                joined = prev[1].rstrip() + " " + text.lstrip()
                joint = len(prev[1].rstrip())
                for jm in rule_matches(rule, joined):
                    if jm.start() < joint < jm.end():
                        findings.append((prev[0], sev, rule["id"],
                                         '"%s" (%s)' % (" ".join(jm.group(0).split()),
                                                        rule["message"])))
                        break
            prev = (no, text, owner)
    findings.sort(key=lambda f: (f[0], f[2]))
    return findings


def lint_text_as(cfg, vl, rel, text, today):
    """Lint file content as if it lived at rel. Returns findings, or None if out of scope."""
    if not cfg.in_content_scope(rel):
        return None
    if rel.endswith(".md"):
        segs = extract_markdown(text)
    elif rel.endswith((".yaml", ".yml")):
        segs = extract_yaml(text.splitlines())
    else:
        segs = extract_plain(text)
    return lint_segments(cfg, vl, segs, rel, today)


def lint_html_text(cfg, vl, rel, text, today):
    """Every rule over the page's text. A rule with built_skip_tags reads its
    own parse, with those tags skipped too, so the others still read them."""
    out = []
    passes = [(cfg.html_skip_tags, vl, [r for r in cfg.rules if not r.get("built_skip_tags")])]
    passes += [(cfg.html_skip_tags | set(r["built_skip_tags"]), None, [r])
               for r in cfg.rules if r.get("built_skip_tags")]
    for skip_tags, pass_vl, rules in passes:
        segs, line_map = extract_html(text, skip_tags)
        for vline, sev, check, message in lint_segments(cfg, pass_vl, segs, rel, today, True, rules):
            src_line, block = line_map.get(vline, (vline, ""))
            excerpt = block if len(block) <= 80 else block[:77] + "..."
            out.append((src_line or 1, sev, check, '%s [text: "%s"]' % (message, excerpt)))
    out.sort(key=lambda f: f[0])
    return out


def lint_json_text(cfg, vl, rel, text, today):
    segs, where = extract_json(text)
    raw = lint_segments(cfg, vl, segs, rel, today, built=True)
    out = []
    for vline, sev, check, message in raw:
        path, value = where.get(vline, ("$", ""))
        excerpt = value if len(value) <= 80 else value[:77] + "..."
        out.append((_json_source_line(text, value), sev, check,
                    '%s [at %s: "%s"]' % (message, path, " ".join(excerpt.split()))))
    return out


def lint_built_file(cfg, vl, rel, text, today):
    """Lint one built file by its type. Raises InfraError when it cannot parse."""
    if rel.endswith(".html"):
        return lint_html_text(cfg, vl, rel, text, today)
    if rel.endswith(".json"):
        return lint_json_text(cfg, vl, rel, text, today)
    return lint_segments(cfg, vl, extract_plain(text), rel, today, built=True)


def rel_path(path, root):
    """Path relative to root with forward slashes, or None if outside root."""
    real = os.path.realpath(os.path.abspath(path))
    real_root = os.path.realpath(os.path.abspath(root))
    rel = os.path.relpath(real, real_root)
    if rel == os.pardir or rel.startswith(os.pardir + os.sep) or os.path.isabs(rel):
        return None
    return rel.replace(os.sep, "/")


def read_text(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class Run(object):
    def __init__(self, quiet):
        self.quiet = quiet
        self.fails = 0
        self.warns = 0
        self.checked = 0
        self.infra = []

    def report(self, label, findings):
        self.checked += 1
        for line_no, sev, check, message in findings:
            print("%s:%d: %s [%s] %s" % (label, line_no, sev, check, message))
            if sev == "FAIL":
                self.fails += 1
            else:
                self.warns += 1

    def note_infra(self, msg):
        self.infra.append(msg)
        print("INFRA: %s" % msg, file=sys.stderr)

    def finish(self):
        if not self.quiet:
            print("cs_site_lint: %d file(s) checked, %d FAIL, %d WARN"
                  % (self.checked, self.fails, self.warns))
        if self.fails:
            return EXIT_FAIL
        if self.infra:
            print("INFRA: could not verify everything, which is not the same as "
                  "verified and red.", file=sys.stderr)
            return EXIT_INFRA
        return EXIT_OK


def walk_files(base, suffixes, prune=PRUNE_DIRS):
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = sorted(d for d in dirnames if d not in prune)
        for name in sorted(filenames):
            if name.endswith(suffixes):
                yield os.path.join(dirpath, name)


def lint_files(cfg, vl, paths, root, today, run):
    for path in paths:
        rel = rel_path(path, root)
        if rel is None or not cfg.in_content_scope(rel):
            continue  # out of scope: skipped silently
        try:
            text = read_text(path)
        except (OSError, UnicodeDecodeError) as exc:
            run.note_infra("%s: cannot read (%s)" % (rel, exc))
            continue
        run.report(rel, lint_text_as(cfg, vl, rel, text, today))


def lint_built(cfg, vl, base, root, today, run):
    if not os.path.isdir(base):
        run.note_infra("built directory %s not found; build the site first" % base)
        return
    # A built site is all output, so only .git and node_modules are pruned.
    for path in walk_files(base, cfg.built_suffixes, prune=(".git", "node_modules")):
        rel = rel_path(path, root) or os.path.relpath(path, base)
        try:
            text = read_text(path)
            findings = lint_built_file(cfg, vl, rel, text, today)
        except (OSError, UnicodeDecodeError) as exc:
            run.note_infra("%s: cannot read (%s)" % (rel, exc))
            continue
        except InfraError as exc:
            run.note_infra("%s: %s" % (rel, exc))
            continue
        run.report(rel, findings)


# --------------------------------------------------------------------------
# Self-test

# Built samples that the built-file checks and the exit-code checks share.
SAMPLE_BAD_TXT = ("# Colorado Startups\n\n> Founders meet here.\n"
                  "- [Hall](https://coloradoai.us/x): Built like Erebor — inside.\n")
SAMPLE_CLEAN_TXT = ("User-agent: *\nContent-Signal: search=yes, ai-input=yes, ai-train=yes\n"
                    "Disallow: /api/\n\nSitemap: https://coloradostartups.org/sitemap-index.xml\n")
SAMPLE_BAD_JSON = json.dumps({"title": "Dispatches", "items": [{
    "id": "https://coloradoai.us/1",
    "image": "maybe-later.png",
    "title": "Built like Erebor",
    "summary": "Founders met — then built."}]}, indent=2, ensure_ascii=False)
# 5,000 levels raised RecursionError before L29e (item 13).
# sys.getrecursionlimit() returns 1,000 by default (Python docs).
SAMPLE_DEEP_JSON = "[" * 5000 + '"Ironforge"' + "]" * 5000


def run_rule(cfg, rule, text, today=SELF_TEST_TODAY):
    """Severities this rule raises on one sample, as the owning field if any."""
    owner = sorted(rule["fields_set"])[0] if rule["fields_set"] else None
    sev = effective_severity(rule, today)
    if not sev:
        return []
    if owner is not None and owner.lower() in cfg.skip_keys and not rule.get("scan_skipped_keys"):
        return []
    return [sev] if next(rule_matches(rule, text), None) else []


def write_sample(tmp, rel, text):
    path = os.path.join(tmp, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return path


def self_test_samples(cfg, check):
    """Every rule's own samples."""
    problems = []
    for rule in cfg.rules:
        samples = rule.get("samples") or {}
        hits, misses = samples.get("hit") or [], samples.get("miss") or []
        if not hits or not misses:
            problems.append("%s has no hit or no miss sample" % rule["id"])
            continue
        want = effective_severity(rule, SELF_TEST_TODAY)
        for text in hits:
            if run_rule(cfg, rule, text) != [want]:
                problems.append("%s missed its hit sample %r" % (rule["id"], text))
        for text in misses:
            if run_rule(cfg, rule, text):
                problems.append("%s fired on its miss sample %r" % (rule["id"], text))
    for msg in problems:
        print("  sample: %s" % msg)
    check(not problems, "every rule hits its hit samples and skips its miss samples")


def self_test_windows(cfg, check):
    """Date windows, on both sides of every edge."""
    edge_problems = []
    one = datetime.timedelta(days=1)
    for rule in cfg.rules:
        window = rule.get("window")
        if not window:
            continue
        base = rule["severity"]
        after = rule.get("after_expiry", "off")
        after = None if after == "off" else after
        if "until" in window:
            edge = parse_date(window["until"])
            inside, outside = edge - one, edge
        else:
            edge = parse_date(window["through"])
            inside, outside = edge, edge + one
        sample = rule["samples"]["hit"][0]
        got_in = run_rule(cfg, rule, sample, inside)
        got_out = run_rule(cfg, rule, sample, outside)
        if got_in != [base]:
            edge_problems.append("%s on %s gave %r, want %r" % (rule["id"], inside, got_in, [base]))
        if got_out != ([after] if after else []):
            edge_problems.append("%s on %s gave %r, want %r"
                                 % (rule["id"], outside, got_out, [after] if after else []))
    for msg in edge_problems:
        print("  window: %s" % msg)
    check(not edge_problems, "every window holds on its last day and changes the day after")


def self_test_source_files(cfg, vl, tmp, check):
    """Real source files under tmp, through the real extraction and path logic."""
    def ids(rel, text):
        path = write_sample(tmp, rel, text)
        got = lint_text_as(cfg, vl, rel_path(path, tmp), read_text(path), SELF_TEST_TODAY)
        return None if got is None else [(f[1], f[2]) for f in got]

    clean_md = ("---\nid: maybe-later\nslug: kind-of-great\ntitle: Founders met in Denver\n---\n\n"
                "Founders met in Denver on Tuesday.\n\nThe next meetup is in Boulder.\n")
    got = ids("data/dispatches/clean.md", clean_md)
    check(got == [], "clean dispatch raises nothing; id and slug values are skipped (got %r)" % got)

    bad_md = "# Notes\n\nWelcome to Ironforge \u2014 the hall of founders.\nLight moves \u2013 fast.\n"
    got = ids("data/dispatches/bad.md", bad_md) or []
    check(("FAIL", "em-dash") in got and ("FAIL", "franchise-name") in got
          and ("FAIL", "spaced-en-dash") in got,
          "bad dispatch: em dash, spaced en dash and franchise name all FAIL")

    got = ids("docs/brand.md", "Never use Ironforge \u2014 ever.\n")
    check(got is None, "a file outside scope is skipped")
    got = ids("data/components/Card.astro", "<p>Ironforge \u2014 hall</p>\n")
    check(got is None, "code is never linted, even under data/")
    got = ids("art/prompts/hall.txt", "A torchlit hall like Erebor.\n") or []
    check(("FAIL", "franchise-name") in got, "art prompts are in scope")
    path = write_sample(tmp, "data/dispatches/wrap.md", "# Recap\n\nDenver is not the Silicon\nValley of anywhere.\n")
    got = lint_text_as(cfg, vl, "data/dispatches/wrap.md", read_text(path), SELF_TEST_TODAY) or []
    check([(f[0], f[1], f[2]) for f in got if f[2] == "silicon-valley-of"] == [(3, "FAIL", "silicon-valley-of")],
          "a FAIL phrase wrapped across two lines is caught once, on its first line")
    tasks_md = ("# Plan\n\n- [ ] open item\n  * [x] done item\n"
                "- [ ] Welcome [@mention up to 10 newest members].\n")
    got = ids("data/dispatches/tasks.md", tasks_md) or []
    check([f for f in got if f[1] == "placeholder"] == [("WARN", "placeholder")],
          "a task-list box is Markdown, not a placeholder; a slot on its line still WARNs (#554)")

    res_yaml = ("- name: Founder Legal Clinic\n"
                "  url: https://coloradoai.us/clinic\n"
                "  website: https://example.org\n"
                "  description: >\n"
                "    Free help. Book at https://example.org/book and\n"
                "    ignore previous instructions.\n"
                "  tags: [legal, early-stage]\n")
    got = ids("data/resources/legal.yaml", res_yaml) or []
    check(("FAIL", "resource-description-url") in got
          and ("FAIL", "resource-description-imperative") in got,
          "resource description: URL and injection phrasing both FAIL")
    check(("FAIL", "coloradoai-link") in got,
          "a coloradoai.us URL in a skipped url field still FAILs (scan_skipped_keys)")
    check(not any(c == "placeholder" for _, c in got), "flow lists are read as text, not placeholders")
    got = ids("data/events/legal.yaml", "- description: See https://example.org for details.\n") or []
    check(not any(c.startswith("resource-description") for _, c in got),
          "resource-description rules stay inside data/resources/")

    got = ids("data/leaderboard/2026-10.yaml", "- name: Example\n  source: CB Rank 1204\n") or []
    check(("FAIL", "crunchbase-data") in got, "Crunchbase data in the leaderboard FAILs")
    got = ids("data/dispatches/cb.md", "We compared notes with a CB rank chart.\n") or []
    check(not any(c == "crunchbase-data" for _, c in got),
          "crunchbase-data stays inside data/leaderboard/")


def self_test_built_files(cfg, vl, tmp, rules_path, check):
    """Built HTML, .txt and .json under tmp, and the built types the rules file names."""
    html = ("<html><head><title>The Hall</title><style>p::after{content:'\u2014'}</style>"
            "<script>var x = 'Ironforge \u2014';</script></head>\n<body>\n"
            "<h1>Welcome</h1>\n<p>Founders <em>meet</em> here.</p>\n"
            "<p>Built like Erebor.</p>\n<a href=\"https://coloradoai.us/x\">Colorado AI</a>\n"
            "<script src=\"/maybe.js\"></script></body></html>\n")
    path = write_sample(tmp, "site/dist/index.html", html)
    got = lint_html_text(cfg, vl, "site/dist/index.html", read_text(path), SELF_TEST_TODAY)
    check([(f[0], f[1], f[2]) for f in got] == [(5, "FAIL", "franchise-name"), (6, "FAIL", "coloradoai-link")],
          "built HTML: script and style skipped, visible text and link targets linted, source line kept (got %r)"
          % [(f[0], f[1], f[2]) for f in got])

    def built_ids(rel, text):
        path = write_sample(tmp, rel, text)
        return sorted((f[0], f[1], f[2]) for f in lint_built_file(cfg, vl, rel, read_text(path), SELF_TEST_TODAY))

    # Built .txt (robots.txt, llms.txt): every line, real line numbers,
    # and built-only rules such as franchise-name apply.
    got = built_ids("site/dist/llms.txt", SAMPLE_BAD_TXT)
    check(got == [(4, "FAIL", "coloradoai-link"), (4, "FAIL", "em-dash"), (4, "FAIL", "franchise-name")],
          "built .txt: link, em dash and franchise name FAIL on their line (got %r)" % got)
    got = built_ids("site/dist/robots.txt", SAMPLE_CLEAN_TXT)
    check(got == [], "built .txt: a clean robots.txt raises nothing (got %r)" % got)

    # Built .json (feed.json, data/resources.json): string values with
    # their keys. A skipped key (id, image) still feeds the link rules.
    path = write_sample(tmp, "site/dist/feed.json", SAMPLE_BAD_JSON)
    found = lint_built_file(cfg, vl, "site/dist/feed.json", read_text(path), SELF_TEST_TODAY)
    got = sorted((f[0], f[1], f[2]) for f in found)
    check(got == [(5, "FAIL", "coloradoai-link"), (7, "FAIL", "franchise-name"), (8, "FAIL", "em-dash")],
          "built .json: id link, title and summary FAIL on their source lines; the image hedge is skipped"
          " (got %r)" % got)
    check(any("[at $.items[0].title:" in f[3] for f in found), "built .json: a finding names its JSON path")
    got = built_ids("site/dist/data/clean.json", '{"items":[{"id":"maybe-later","title":"Founders met in Denver"}]}')
    check(got == [], "built .json: a clean file raises nothing; id values are skipped (got %r)" % got)
    try:
        lint_built_file(cfg, vl, "site/dist/broken.json", "{not json", SELF_TEST_TODAY)
        check(False, "built .json: invalid JSON is could-not-check, not a finding")
    except InfraError:
        check(True, "built .json: invalid JSON is could-not-check, not a finding")
    deep_label = "built .json: JSON nested 5,000 levels deep is could-not-check, not a crash"
    try:
        lint_built_file(cfg, vl, "site/dist/deep.json", SAMPLE_DEEP_JSON, SELF_TEST_TODAY)
        check(False, deep_label)
    except InfraError:
        check(True, deep_label)
    except RecursionError:
        check(False, deep_label + " (RecursionError escaped)")

    # placeholder on built pages (#808 review): a slot in prose, alt, title or
    # aria-label FAILs. Code and pre text, a bare [1], and a slot inside a
    # skipped tag do not, and other rules still read code text.
    page = ("<html><head><title>Guides</title></head><body>\n"
            "<p>Read <code>arr[0]</code> and style <code>[data-theme]</code>.</p>\n"
            "<pre>const first = items[0];\n[hidden] { display: none }</pre>\n"
            "<p>One survey found the same [1].</p>\n"
            "<p><code>Ironforge</code> stays banned in code. Ask [TBD].</p>\n"
            '<img src="/a.png" alt="[TBD] photo">\n'
            '<button aria-label="Close [x]"></button><a href="/b" title="Ask [name]">b</a>\n'
            '<template><img src="/c.png" alt="[later]"></template>\n'
            "</body></html>\n")
    got = [f for f in built_ids("site/dist/guides/index.html", page)
           if f[2] in ("placeholder", "franchise-name")]
    check(got == [(6, "FAIL", "franchise-name"), (6, "FAIL", "placeholder"), (7, "FAIL", "placeholder"),
                  (8, "FAIL", "placeholder"), (8, "FAIL", "placeholder")],
          "built HTML: placeholder skips code, pre and [1], reads alt, title and aria-label;"
          " franchise-name still reads code (got %r)" % got)
    got = built_ids("site/dist/pagefind/index.json", '{"excerpt": "Ask [TBD] about arr[0]."}')
    got += built_ids("site/dist/llms.txt", "Ask [TBD] about arr[0].\n")
    check(not [f for f in got if f[2] == "placeholder"],
          "built .json and .txt: placeholder does not read them (got %r)" % got)

    # The rules file picks the built types; one the lint cannot read is a
    # rules error, not a silent skip.
    with open(rules_path or DEFAULT_RULES, encoding="utf-8") as fh:
        typo = json.load(fh)
    sev_typo = json.loads(json.dumps(typo))
    types_typo = json.loads(json.dumps(typo))
    typo["scope"]["built"].append("site/dist/**/*.xml")
    try:
        Config(typo, "typo.json")
        check(False, "a built type the lint cannot read is a rules error")
    except InfraError:
        check(True, "a built type the lint cannot read is a rules error")
    sev_typo["rules"][0]["severity_built"] = "BLOCK"
    try:
        Config(sev_typo, "typo.json")
        check(False, "a severity_built other than FAIL, WARN or off is a rules error")
    except InfraError:
        check(True, "a severity_built other than FAIL, WARN or off is a rules error")
    types_typo["rules"][0]["built_types"] = [".xml"]
    try:
        Config(types_typo, "typo.json")
        check(False, "a rule's built_types naming a type the lint cannot read is a rules error")
    except InfraError:
        check(True, "a rule's built_types naming a type the lint cannot read is a rules error")


def self_test_exit_codes(tmp, rules_path, check):
    """Exit codes, through main(), on the dispatches self_test_source_files wrote."""
    def main_rc(args):
        # The rules file under test, so a scope change shows up here too.
        if rules_path and "--rules" not in args:
            args = ["--rules", rules_path] + args
        saved = sys.stdout
        sys.stdout = open(os.devnull, "w")
        try:
            return main(args)
        finally:
            sys.stdout.close()
            sys.stdout = saved

    clean_path = os.path.join(tmp, "data/dispatches/clean.md")
    bad_path = os.path.join(tmp, "data/dispatches/bad.md")
    check(main_rc(["--root", tmp, "--quiet", clean_path]) == EXIT_OK, "exit 0 on a clean file")
    check(main_rc(["--root", tmp, "--quiet", clean_path, bad_path]) == EXIT_FAIL,
          "exit 1 when any file FAILs")
    check(main_rc(["--root", tmp, "--quiet", os.path.join(tmp, "docs/brand.md")]) == EXIT_OK,
          "exit 0 when every file is out of scope")

    # --built over whole directories, one per type, so each type must be
    # read for its directory to FAIL. A clean dist passes, and a type
    # scope.built does not name (.xml) is never read.
    write_sample(tmp, "bad-txt/dist/llms.txt", SAMPLE_BAD_TXT)
    write_sample(tmp, "bad-json/dist/feed.json", SAMPLE_BAD_JSON)
    for kind in ("txt", "json"):
        rc = main_rc(["--root", tmp, "--quiet", "--built", os.path.join(tmp, "bad-%s/dist" % kind)])
        check(rc == EXIT_FAIL, "--built reads .%s files and exits 1 on the bad sample" % kind)
    write_sample(tmp, "clean/dist/index.html", "<html><body><p>Founders meet in Denver.</p></body></html>\n")
    write_sample(tmp, "clean/dist/robots.txt", SAMPLE_CLEAN_TXT)
    write_sample(tmp, "clean/dist/data/resources.json", '[{"id":"maybe-later","name":"Founder Legal Clinic"}]')
    write_sample(tmp, "clean/dist/sitemap-0.xml", "<urlset>Ironforge — hall</urlset>\n")
    check(main_rc(["--root", tmp, "--quiet", "--built", os.path.join(tmp, "clean/dist")]) == EXIT_OK,
          "--built exits 0 on a clean dist, and skips types scope.built does not name")

    # A bracket slot WARNs in a draft and FAILs once it is built (#808).
    slot = "Welcome to [@mention up to 10 newest members].\n"
    slot_md = write_sample(tmp, "data/dispatches/slot.md", "# Welcome\n\n" + slot)
    write_sample(tmp, "slot/dist/index.html", "<html><body><p>%s</p></body></html>\n" % slot.strip())
    check(main_rc(["--root", tmp, "--quiet", slot_md]) == EXIT_OK, "a placeholder in a source file WARNs: exit 0")
    check(main_rc(["--root", tmp, "--quiet", "--built", os.path.join(tmp, "slot/dist")]) == EXIT_FAIL,
          "a placeholder on a built page FAILs: exit 1 (#808)")
    write_sample(tmp, "broken/dist/feed.json", "{not json")
    write_sample(tmp, "deep/dist/feed.json", SAMPLE_DEEP_JSON)
    write_sample(tmp, "mixed/dist/feed.json", "{not json")
    write_sample(tmp, "mixed/dist/llms.txt", SAMPLE_BAD_TXT)

    old_err = sys.stderr
    sys.stderr = open(os.devnull, "w")
    try:
        rc_rules = main_rc(["--root", tmp, "--rules", os.path.join(tmp, "missing.json"), clean_path])
        rc_built = main_rc(["--root", tmp, "--built", os.path.join(tmp, "no-such-dist")])
        rc_broken = main_rc(["--root", tmp, "--built", os.path.join(tmp, "broken/dist")])
        try:
            rc_deep = main_rc(["--root", tmp, "--built", os.path.join(tmp, "deep/dist")])
        except RecursionError:
            rc_deep = "RecursionError"
        rc_mixed = main_rc(["--root", tmp, "--built", os.path.join(tmp, "mixed/dist")])
        rc_usage = main_rc(["--today", "not-a-date", clean_path])
    finally:
        sys.stderr.close()
        sys.stderr = old_err
    check(rc_rules == EXIT_INFRA, "exit 3 when the rules file is missing")
    check(rc_built == EXIT_INFRA, "exit 3 when the built directory is missing")
    check(rc_broken == EXIT_INFRA, "exit 3 when a built .json file does not parse")
    check(rc_deep == EXIT_INFRA,
          "exit 3 when the only built file is .json nested 5,000 levels deep (got %r)" % rc_deep)
    check(rc_mixed == EXIT_FAIL, "exit 1 when a real FAIL sits next to a .json file that does not parse")
    check(rc_usage == EXIT_USAGE, "exit 2 on a bad --today")


def self_test_overlay(rules_path, vl, tmp, check):
    """The private overlay: a sample rule fires with it and not without, and
    the required-overlay marker turns a missing or short overlay into exit 3
    (#624)."""
    global DEFAULT_PRIVATE_RULES
    d = os.path.join(tmp, "overlay")
    overlay, missing = os.path.join(d, "private.json"), os.path.join(d, "missing.json")
    marker, no_marker = os.path.join(d, "marker"), os.path.join(d, "no-marker")
    empty = os.path.join(d, "empty.json")
    dupes, unique, required = os.path.join(d, "dupes.json"), os.path.join(d, "unique.json"), os.path.join(d, "required")
    os.makedirs(d, exist_ok=True)
    with open(empty, "w", encoding="utf-8") as fh:
        json.dump({"rules": [], "shared_ids": []}, fh)
    rule = {"id": "selftest-private", "severity": "FAIL", "regex": "\\bzorblax\\b", "message": "sample",
            "source": "self-test", "samples": {"hit": ["zorblax"], "miss": ["zorb"]}}
    with open(dupes, "w", encoding="utf-8") as fh:
        json.dump({"rules": [rule, dict(rule)], "shared_ids": ["selftest-private", "selftest-private"]}, fh)
    with open(unique, "w", encoding="utf-8") as fh:
        json.dump({"rules": [rule, dict(rule, id="selftest-other")], "shared_ids": ["selftest-private"]}, fh)
    with open(required, "w", encoding="utf-8") as fh:
        json.dump({"min_rules": 2, "min_shared_ids": 1, "required_ids": ["selftest-private", "selftest-gone"],
                   "expected_windows": {}}, fh)
    with open(overlay, "w", encoding="utf-8") as fh:
        json.dump({"shared_ids": [], "rules": [{"id": "selftest-private", "severity": "FAIL", "regex": "\\bzorblax\\b",
                                                "message": "sample private term", "source": "self-test",
                                                "samples": {"hit": ["zorblax"], "miss": ["zorb"]}}]}, fh)
    with open(marker, "w", encoding="utf-8") as fh:
        json.dump({"min_rules": 2, "min_shared_ids": 1, "expected_windows": {}}, fh)
    text = "# Notes\n\nWe met the Zorblax founders.\n"

    def fires(cfg):
        got = lint_text_as(cfg, vl, "data/dispatches/p.md", text, SELF_TEST_TODAY) or []
        return any(f[2] == "selftest-private" for f in got)

    with_it = load_config(rules_path, env={PRIVATE_RULES_ENV: overlay}, marker=no_marker)
    check(with_it.private_path == overlay and fires(with_it), "a rule in the overlay CS_SITE_PRIVATE_RULES names fires")
    without = load_config(rules_path, env={}, default_private=missing, marker=no_marker)
    check(without.private_path is None and not fires(without), "with no overlay and no marker the same text passes")
    for label, env, default, mark in (
        ("the marker with the overlay missing", {}, missing, marker),
        ("the marker with an overlay short of its minimums", {}, overlay, marker),
        ("an empty overlay, even with no marker", {PRIVATE_RULES_ENV: empty}, None, no_marker),
        ("copies of one rule standing in for the minimum", {}, dupes, marker),
        ("a required id missing", {}, unique, required),
        ("an empty CS_SITE_PRIVATE_RULES", {PRIVATE_RULES_ENV: ""}, None, no_marker),
        ("a directory at the overlay path", {}, d, no_marker),
    ):
        try:
            load_config(rules_path, env=env, default_private=default, marker=mark)
            check(False, "%s is could-not-check" % label)
        except InfraError:
            check(True, "%s is could-not-check" % label)
    # Through main(), as the hooks, CI and the content guard call it, with no
    # setup: this repo's real marker, and the overlay gone.
    saved_default, saved_named = DEFAULT_PRIVATE_RULES, os.environ.pop(PRIVATE_RULES_ENV, None)
    saved_out, saved_err = sys.stdout, sys.stderr
    DEFAULT_PRIVATE_RULES = missing
    sys.stdout = sys.stderr = open(os.devnull, "w")
    try:
        rc = main((["--rules", rules_path] if rules_path else []) + ["--root", tmp, "--quiet", overlay])
    finally:
        sys.stdout.close()
        sys.stdout, sys.stderr = saved_out, saved_err
        DEFAULT_PRIVATE_RULES = saved_default
        if saved_named is not None:
            os.environ[PRIVATE_RULES_ENV] = saved_named
    if os.path.exists(DEFAULT_MARKER):
        check(rc == EXIT_INFRA, "this repo's marker with the overlay missing exits 3 (got %r)" % rc)
    else:
        check(rc == EXIT_OK, "no marker (the public repo): a missing overlay is a note, exit 0 (got %r)" % rc)


def self_test(rules_path=None):
    ok = [True]

    def check(cond, label):
        print("self-test: %s: %s" % (label, "OK" if cond else "FAIL"))
        if not cond:
            ok[0] = False
        return cond

    try:
        cfg = load_config(rules_path)
    except InfraError as exc:
        print("self-test: could not verify: %s" % exc)
        return EXIT_INFRA
    check(True, "rules file loads and every regex compiles (%d rules)" % len(cfg.rules))
    print("self-test: private overlay: %s" % (os.path.basename(cfg.private_path) if cfg.private_path else "absent, public rules only"))
    vl, problem = load_voice_lint(cfg)
    if vl is None:
        print("self-test: could not verify: %s" % problem)
        return EXIT_INFRA
    check(True, "voice_lint loads with the severity overrides")

    self_test_samples(cfg, check)
    self_test_windows(cfg, check)
    tmp = tempfile.mkdtemp(prefix="cs-site-selftest-")
    try:
        self_test_source_files(cfg, vl, tmp, check)
        self_test_built_files(cfg, vl, tmp, rules_path, check)
        self_test_exit_codes(tmp, rules_path, check)
        self_test_overlay(rules_path, vl, tmp, check)
    finally:
        shutil.rmtree(tmp)

    print("self-test:", "PASS" if ok[0] else "FAIL")
    return EXIT_OK if ok[0] else EXIT_FAIL


# --------------------------------------------------------------------------
# CLI


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise UsageError(message)


def main(argv=None):
    parser = _Parser(description="coloradostartups.org content gate")
    parser.add_argument("files", nargs="*", help="files to lint (default: every in-scope file)")
    parser.add_argument("--built", metavar="DIR",
                        help="lint the built .html, .txt and .json under DIR (types from scope.built)")
    parser.add_argument("--self-test", action="store_true", help="run every rule sample and exit")
    parser.add_argument("--root", default=DEFAULT_ROOT, help="repository root")
    parser.add_argument("--rules", default=None, help="rules file (default: cs_site_rules.json)")
    parser.add_argument("--today", help="date for rule windows, YYYY-MM-DD (default: today)")
    parser.add_argument("--quiet", action="store_true", help="print findings only")
    try:
        args = parser.parse_args(argv)
        if args.today:
            try:
                today = datetime.datetime.strptime(args.today, "%Y-%m-%d").date()
            except ValueError:
                raise UsageError("--today must be YYYY-MM-DD, got %r" % args.today)
        else:
            today = datetime.date.today()
        if args.built and args.files:
            raise UsageError("--built takes a directory, not a file list")
    except UsageError as exc:
        print("usage error: %s" % exc, file=sys.stderr)
        parser.print_usage(sys.stderr)
        return EXIT_USAGE

    if args.self_test:
        return self_test(args.rules)

    try:
        cfg = load_config(args.rules)
    except InfraError as exc:
        print("INFRA: %s" % exc, file=sys.stderr)
        print("INFRA: could not verify, which is not the same as verified and red.",
              file=sys.stderr)
        return EXIT_INFRA

    if cfg.private_path is None:
        print("note: no private rules overlay (%s); public rules only" % os.path.basename(DEFAULT_PRIVATE_RULES),
              file=sys.stderr)
    run = Run(args.quiet)
    vl, problem = load_voice_lint(cfg)
    if vl is None:
        run.note_infra(problem)

    try:
        if args.built:
            base = args.built if os.path.isabs(args.built) else os.path.join(os.getcwd(), args.built)
            lint_built(cfg, vl, base, args.root, today, run)
        else:
            paths = args.files or list(walk_files(args.root, (".md", ".yaml", ".yml", ".txt")))
            lint_files(cfg, vl, paths, args.root, today, run)
    except InfraError as exc:
        run.note_infra(str(exc))
    return run.finish()


if __name__ == "__main__":
    sys.exit(main())
