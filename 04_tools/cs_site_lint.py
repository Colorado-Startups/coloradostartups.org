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
import os
import re
import sys

# No __pycache__ in the repo: these tools run from hooks on every commit.
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
# python3 -I leaves this folder off sys.path; the lint's parts sit beside it.
if HERE not in sys.path:
    sys.path.insert(0, HERE)
# One module whether run as a script or imported, so the self-test's parts
# reach this main() and these globals, not a second copy.
sys.modules.setdefault("cs_site_lint", sys.modules[__name__])

import cs_site_lint_rules as _rules  # noqa: E402
from cs_site_lint_rules import (  # noqa: E402,F401
    DEFAULT_MARKER, DEFAULT_ROOT, DEFAULT_RULES, EXIT_FAIL, EXIT_INFRA, EXIT_OK, EXIT_USAGE,
    PRIVATE_RULES_ENV, Config, InfraError, UsageError, effective_severity, glob_match, glob_to_regex,
    load_config, load_rules_data, load_voice_lint, parse_date, rule_applies_to, rule_matches,
)
from cs_site_lint_extract import (  # noqa: E402,F401
    _json_source_line, extract_html, extract_json, extract_markdown, extract_plain, extract_yaml,
)

FENCE_RE = re.compile(r"^\s*(```|~~~)")
PRUNE_DIRS = {".git", "node_modules", ".astro", ".wrangler", "dist", "__pycache__", "local"}


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
        from cs_site_lint_selftest import self_test
        return self_test(args.rules)

    try:
        cfg = load_config(args.rules)
    except InfraError as exc:
        print("INFRA: %s" % exc, file=sys.stderr)
        print("INFRA: could not verify, which is not the same as verified and red.",
              file=sys.stderr)
        return EXIT_INFRA

    if cfg.private_path is None:
        print("note: no private rules overlay (%s); public rules only" % os.path.basename(_rules.DEFAULT_PRIVATE_RULES),
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
