#!/usr/bin/env python3
"""gitleaks_allow.py: does gitleaks' inline allow marker appear only where allowed?

gitleaks skips every finding on a line that carries its inline allow marker,
so one beside a real key would hide the key from every secret scan (#774).
04_tools/gitleaks_allow.json lists where the marker may appear: a path, plus
text the same line must also hold.

Two reads, both judged by that list:
  the tree   every tracked text file (git grep). A marker no entry covers
             fails; so does an entry that covers more than one line. An entry
             that covers none warns: on a pull request CI judges the tree by
             the base commit's list, so a new marker takes two pull requests,
             the entry first, and main stays green between them.
  --range    every line with the marker that a commit in BASE..HEAD adds,
             even one a later commit deletes, since a merge keeps that commit
             and the full-history scan reads it.
The marker is built at run time, so this file holds none.

Usage:
  python3 -I 04_tools/gitleaks_allow.py [--root DIR] [--allowlist FILE] [--range BASE..HEAD]
  python3 -I 04_tools/gitleaks_allow.py --check-list FILE
  python3 -I 04_tools/gitleaks_allow.py --self-test

Exit codes (04_tools/README.md, Exit contract):
  0  every marker is allowed (an entry that matches no line only warns)
  1  a marker outside the allowlist, an entry that covers more than one line,
     or an entry the list's rules refuse (no path, no why, a line_has under 8
     characters)
  2  usage error
  3  could not check: git failed, its output could not be read, or the list
     is unreadable or not JSON

Python 3.9 or later, standard library only.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile

MARKER = "gitleaks" + ":allow"
MIN_LINE_HAS = 8
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"  # git's empty tree, a root commit's parent
DEFAULT_ALLOWLIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gitleaks_allow.json")


class CouldNotCheck(Exception):
    pass


def load_allowlist(path):
    """(entries, problems). Unreadable or unparseable is could-not-check; an
    entry the rules refuse is a problem, a finding like any other."""
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError) as err:
        raise CouldNotCheck(f"{path}: {err}") from err
    allowed = doc.get("allowed") if isinstance(doc, dict) else None
    if not isinstance(allowed, list):
        return [], [f"{path}: `allowed` must be a list"]
    good, problems = [], []
    for e in allowed:
        ok = isinstance(e, dict) and all(isinstance(e.get(k), str) and e[k].strip() for k in ("path", "line_has", "why"))
        if not ok or len(e["line_has"].strip()) < MIN_LINE_HAS:
            problems.append(f"{path}: every entry needs a path, a why, and a line_has of {MIN_LINE_HAS} characters or more: {e!r}")
        else:
            good.append(e)
    return good, problems


def git(root, *args):
    r = subprocess.run(["git", "-C", root, "-c", "core.quotePath=false", *args], capture_output=True, check=False)
    return r.returncode, r.stdout, r.stderr.decode("utf-8", "replace").strip()


def tree_markers(root):
    """[(path, line number, line)] for every tracked text line with the marker.
    git grep -z writes path NUL number NUL line NEWLINE, so a path holding a
    colon or a newline cannot pass for another path. A path that is not
    UTF-8 decodes with surrogateescape: it matches no entry, so its marker
    is a finding, never a could-not-check."""
    code, out, err = git(root, "grep", "-z", "-n", "-I", "-F", "--no-color", "-e", MARKER)
    if code == 1 and not err:
        return []
    if code != 0:
        raise CouldNotCheck(f"git grep exited {code}: {err}")
    return parse_grep(out)


def parse_grep(out):
    """git grep -z -n output, as [(path, line number, line)]."""
    found, pos = [], 0
    try:
        while pos < len(out):
            a = out.index(b"\0", pos)
            b = out.index(b"\0", a + 1)
            c = out.find(b"\n", b + 1)
            c = len(out) if c < 0 else c
            found.append((out[pos:a].decode("utf-8", "surrogateescape"), int(out[a + 1:b]), out[b + 1:c].decode("utf-8", "replace")))
            pos = c + 1
    except ValueError as err:
        raise CouldNotCheck(f"could not read git grep's output: {err}") from err
    return found


def added_markers(root, rng):
    """[(commit, path, line)] for every line with the marker that a commit in
    rng adds, each commit against its first parent."""
    code, out, err = git(root, "rev-list", "--reverse", rng)
    if code != 0:
        raise CouldNotCheck(f"git rev-list {rng} exited {code}: {err}")
    found = []
    try:
        for commit in out.decode().split():
            code, parents, err = git(root, "rev-list", "--parents", "-n", "1", commit)
            if code != 0:
                raise CouldNotCheck(f"git rev-list --parents {commit}: {err}")
            ids = parents.decode().split()
            parent = ids[1] if len(ids) > 1 else EMPTY_TREE
            code, names, err = git(root, "diff", "-z", "--name-only", "--no-renames", "--text", f"-G{MARKER}", parent, commit)
            if code != 0:
                raise CouldNotCheck(f"git diff {commit}: {err}")
            for path in [n.decode("utf-8", "surrogateescape") for n in names.split(b"\0") if n]:
                code, diff, err = git(root, "diff", "-U0", "--no-color", "--no-renames", "--text", parent, commit, "--", path)
                if code != 0:
                    raise CouldNotCheck(f"git diff {commit} -- {path}: {err}")
                # The diff of one path: its header lines come before the first
                # hunk, and every line after starts with " ", "-" or "+", so
                # an added line that itself starts with "++" is still read.
                in_hunks = False
                for line in diff.decode("utf-8", "replace").split("\n"):
                    if line.startswith("@@"):
                        in_hunks = True
                    elif in_hunks and line.startswith("+") and MARKER in line:
                        found.append((commit, path, line[1:]))
    except ValueError as err:
        raise CouldNotCheck(f"could not read git's output for {rng}: {err}") from err
    return found


def covers(entry, path, text):
    return entry["path"] == path and entry["line_has"] in text


def check(tree, added, allowed):
    """(findings, warnings) for the tree's markers and the range's added ones."""
    findings, warnings = [], []
    hits = [[] for _ in allowed]
    for path, num, text in tree:
        idx = [i for i, e in enumerate(allowed) if covers(e, path, text)]
        for i in idx:
            hits[i].append(num)
        if not idx:
            findings.append(f"{path}:{num} carries the gitleaks allow marker, and no allowlist entry names that line")
    for i, e in enumerate(allowed):
        if len(hits[i]) > 1:
            findings.append(f"allowlist entry for {e['path']} covers {len(hits[i])} marked lines ({', '.join(map(str, hits[i]))}); an entry names one line")
        elif not hits[i]:
            warnings.append(f"allowlist entry for {e['path']} ({e['line_has'][:40]}...) matches no marked line; drop it, or add its marker")
    for commit, path, text in added:
        if not any(covers(e, path, text) for e in allowed):
            findings.append(f"commit {commit[:8]} adds a line with the gitleaks allow marker to {path} that no allowlist entry names; a later delete does not undo it")
    return findings, warnings


def self_test():
    wrong = 0
    good = [{"path": "a.html", "line_has": "data-cf-beacon='x'", "why": "public tag"}]
    tag = f"<script data-cf-beacon='x'></script> <!-- {MARKER} -->\n"

    def repo(t, commits):
        def g(*a):
            subprocess.run(["git", "-C", t, *a], check=True, capture_output=True)
        g("init", "-q")
        g("config", "user.name", "selftest")
        g("config", "user.email", "selftest@example.com")
        g("config", "commit.gpgsign", "false")
        for files in commits:
            for name, body in files.items():
                full = os.path.join(t, name)
                if body is None:
                    os.unlink(full)
                else:
                    with open(full, "w", encoding="utf-8") as fh:
                        fh.write(body)
            g("add", "-A")
            g("commit", "-q", "--allow-empty", "--no-verify", "-m", "c")

    def case(label, commits, allowed, want, rng=None, want_warn=None):
        nonlocal wrong
        with tempfile.TemporaryDirectory() as t:
            repo(t, commits)
            try:
                findings, warnings = check(tree_markers(t), added_markers(t, rng) if rng else [], allowed)
                got = 1 if findings else 0
                if want_warn is not None and bool(warnings) != want_warn:
                    got = -1
            except CouldNotCheck:
                got = 3
        ok = got == want
        wrong += not ok
        print(f"  {'OK  ' if ok else 'FAIL'} {label}: exit {got}, want {want}")

    base = {"a.html": "x\n" + tag}
    case("clean: the one allowed line", [base], good, 0)
    case("clean: no marker and no entry", [{"b.txt": "nothing\n"}], [], 0)
    case("bad: a marker in another file", [{**base, "k.ts": f'const KEY = "abc"; // {MARKER}\n'}], good, 1)
    case("bad: a second marker in the allowed file", [{"a.html": tag + f"<p>key</p> <!-- {MARKER} -->\n"}], good, 1)
    case("bad: one entry covering two marked lines", [{"a.html": tag + tag}], good, 1)
    case("an entry whose line is gone warns and passes", [{"a.html": "x\n"}], good, 0, want_warn=True)
    case("bad: the allowed text without its marker, a marker on a new line", [{"a.html": "<script data-cf-beacon='x'></script>\n" + f"// {MARKER}\n"}], good, 1)
    case("bad: a path that spoofs the allowed one", [{**base, "a.html:1": f"k = 1 <!-- {MARKER} -->\n"}], good, 1)
    case("bad: a marker committed, then deleted, in the range", [base, {"k.ts": f'const KEY = "abc"; // {MARKER}\n'}, {"k.ts": None}], good, 1, rng="HEAD~2..HEAD")
    case("clean: the range adds only the allowed line", [{"x": "1\n"}, base], good, 0, rng="HEAD~1..HEAD")
    # A name that is not UTF-8: macOS refuses to create one, so the tree case
    # feeds git grep's output to the parser, and the range case commits the
    # path with git's plumbing, which needs no file.
    odd = b"k\xff.ts"
    got = 1 if check(parse_grep(odd + b"\x001\x00key = 1 // " + MARKER.encode() + b"\n"), [], good)[0] else 0
    wrong += got != 1
    print(f"  {'OK  ' if got == 1 else 'FAIL'} bad: a marker in a file whose name is not UTF-8: exit {got}, want 1")
    with tempfile.TemporaryDirectory() as t:
        repo(t, [base])
        def g(*a, data=None):
            return subprocess.run(["git", "-C", t, *a], input=data, check=True, capture_output=True).stdout.strip()
        blob = g("hash-object", "-w", "--stdin", data=b"key = 1 // " + MARKER.encode() + b"\n").decode()
        g("update-index", "--add", "--cacheinfo", f"100644,{blob},".encode() + odd)
        g("commit", "-q", "--no-verify", "-m", "odd name")
        try:
            got = 1 if check([], added_markers(t, "HEAD~1..HEAD"), good)[0] else 0
        except CouldNotCheck:
            got = 3
    wrong += got != 1
    print(f"  {'OK  ' if got == 1 else 'FAIL'} bad: the range adds a marker in a file whose name is not UTF-8: exit {got}, want 1")
    case("bad: the range adds a marked line that starts with ++", [base, {"c.txt": f"++ key = 1 // {MARKER}\n"}, {"c.txt": None}], good, 1, rng="HEAD~2..HEAD")
    for label, body, want in [
        ("an unreadable list", None, 3),
        ("a list that is not JSON", "{", 3),
        ("an entry with a 1-character line_has", {"allowed": [{"path": "a.html", "line_has": "x", "why": "w"}]}, 1),
        ("an entry with no why", {"allowed": [{"path": "a.html", "line_has": "data-cf-beacon"}]}, 1),
    ]:
        with tempfile.TemporaryDirectory() as t:
            p = os.path.join(t, "list.json")
            if body is not None:
                with open(p, "w", encoding="utf-8") as fh:
                    fh.write(body if isinstance(body, str) else json.dumps(body))
            try:
                got = 1 if load_allowlist(p)[1] else 0
            except CouldNotCheck:
                got = 3
        ok = got == want
        wrong += not ok
        print(f"  {'OK  ' if ok else 'FAIL'} {label}: exit {got}, want {want}")
    with tempfile.TemporaryDirectory() as t:
        try:
            tree_markers(t)
            print("  FAIL a folder that is not a git repo must be could-not-check")
            wrong += 1
        except CouldNotCheck:
            print("  OK   a folder that is not a git repo is could-not-check")
    print(f"gitleaks_allow self-test: {'PASS' if not wrong else 'FAIL'}")
    return 1 if wrong else 0


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=".", help="the git work tree to read (default .)")
    ap.add_argument("--allowlist", default=DEFAULT_ALLOWLIST, help="the allowlist (default 04_tools/gitleaks_allow.json beside this file)")
    ap.add_argument("--range", help="BASE..HEAD: also judge every marker line these commits add")
    ap.add_argument("--check-list", metavar="FILE", help="only validate an allowlist's entries")
    ap.add_argument("--self-test", action="store_true")
    try:
        args = ap.parse_args(argv)
    except SystemExit:
        return 2
    if args.self_test:
        return self_test()
    try:
        if args.check_list:
            _, problems = load_allowlist(args.check_list)
            for p in problems:
                print(f"FAIL {p}")
            print(f"gitleaks_allow: {args.check_list}: {len(problems)} entr{'y' if len(problems) == 1 else 'ies'} refused")
            return 1 if problems else 0
        allowed, problems = load_allowlist(args.allowlist)
        tree = tree_markers(args.root)
        added = added_markers(args.root, args.range) if args.range else []
    except CouldNotCheck as err:
        print(f"gitleaks_allow: could not check: {err}", file=sys.stderr)
        return 3
    findings, warnings = check(tree, added, allowed)
    findings = problems + findings
    for w in warnings:
        print(f"WARN {w}")
    for f in findings:
        print(f"FAIL {f}")
    print(f"gitleaks_allow: {len(tree)} marker(s) in the tree, {len(added)} added in the range, {len(allowed)} allowlist entr{'y' if len(allowed) == 1 else 'ies'}, {len(findings)} failing")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
