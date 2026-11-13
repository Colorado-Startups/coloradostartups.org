#!/usr/bin/env python3
"""export_public.py: build the public repo's tree from this archive repo.

Reads 04_tools/export_manifest.json (open-source plan, #552). Default deny:
every tracked path must match a rule, or the export stops. It writes files
into a scratch folder outside the repo and nothing else: no git init, no
remote, no push. Publishing is phase 3, after Paul reads the file list.

Usage:
  python3 04_tools/export_public.py --check [--ref REF]
      classify every path at REF (default HEAD); print counts per folder
  python3 04_tools/export_public.py --out DIR [--ref REF] [--list FILE]
      write the public tree into DIR, which must be outside the repo and
      empty; --list writes the exported paths, one per line
  python3 04_tools/export_public.py --self-test

Exit codes (04_tools/README.md, Exit contract):
  0  every path is classified (and the tree was written)
  1  a path matches no rule, or an overlay file would replace a public one
  2  usage error
  3  could not check: git failed, the manifest is unreadable, DIR is unsafe

Python 3.9 or later, standard library only.
"""

import argparse
import collections
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

# No __pycache__ in the repo: these tools run from hooks on every commit.
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
MANIFEST = os.path.join(HERE, "export_manifest.json")

EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_INFRA = 0, 1, 2, 3


class InfraError(Exception):
    """Could not check. Never reported as a clean export."""


def _lint():
    # One glob syntax for every gate in 04_tools: the content lint's.
    sys.path.insert(0, HERE)
    import cs_site_lint  # noqa: E402
    return cs_site_lint


_LINT = _lint()
glob_match = _LINT.glob_match
# The only paths an overlay file may land on when they are private: the
# internal root docs it replaces (#678). The manifest cannot widen this.
REPLACEABLE = {"README.md", "CONTRIBUTING.md", "SECURITY.md", "AGENTS.md", "CLAUDE.md", "REVIEW.md"}


def glob_match_any_case(pattern, path):
    """Whether path matches the lint's glob, ignoring case."""
    return bool(re.compile(_LINT.glob_to_regex(pattern).pattern, re.IGNORECASE).match(path))


def malformed(path):
    """Why a path is not a plain repo path, or None: one spelling per file (#678).

    Printable ASCII only, so a look-alike letter (Cyrillic a for Latin a) is
    no second spelling of a path. No segment ends in a dot or space, which
    Windows drops, and none holds a colon, which NTFS reads as a stream (#691).
    """
    if not path or path.startswith("/") or "\\" in path:
        return "absolute, empty or backslash"
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in path):
        return "control character"
    if any(ord(c) > 0x7E for c in path):
        return "not printable ASCII"
    segments = path.split("/")
    if any(seg in ("", ".", "..") for seg in segments):
        return "an empty, '.' or '..' segment"
    if any(seg.endswith((".", " ")) for seg in segments):
        return "a segment ending in a dot or space"
    if ":" in path:
        return "a colon"
    return None


def load_manifest(path=MANIFEST):
    """The export manifest, checked; raises InfraError when it cannot be read or used."""
    try:
        with open(path, encoding="utf-8") as fh:
            manifest = json.load(fh)
    except (OSError, ValueError) as exc:
        raise InfraError("cannot read the manifest %s (%s)" % (path, exc))
    rules = manifest.get("rules")
    if not isinstance(rules, list) or not rules:
        raise InfraError("manifest %s has no rules" % path)
    # "public" must be a real boolean ("false" is truthy) and the reason real text.
    bad = [r.get("glob", "?") if isinstance(r, dict) else repr(r) for r in rules
           if not isinstance(r, dict) or not isinstance(r.get("glob"), str) or not isinstance(r.get("public"), bool)
           or not isinstance(r.get("reason"), str) or not r["reason"].strip()]
    if bad:
        raise InfraError("every rule needs a string glob, a boolean public and a reason: %s" % bad)
    replaces = manifest.get("overlay_replaces", [])
    if not isinstance(replaces, list) or not all(isinstance(x, str) for x in replaces):
        raise InfraError("overlay_replaces in %s must be a list of strings" % path)
    wider = sorted(set(replaces) - REPLACEABLE)
    if wider:
        raise InfraError("overlay_replaces in %s may name only the root docs %s, not %s"
                         % (path, sorted(REPLACEABLE), wider))
    return manifest


def classify(manifest, path, any_case=False):
    """The first rule that matches path, or None (default deny)."""
    match = glob_match_any_case if any_case else glob_match
    return next((r for r in manifest["rules"] if match(r["glob"], path)), None)


def plan(manifest, paths):
    """What the export does with each path.

    Returns (exported {dest: src}, private [src], unlisted [src], clashes [msg]).
    A file under the overlay folder exports to the root at its relative path.
    """
    overlay = manifest.get("overlay", "").rstrip("/")
    exported, private, unlisted, clashes = {}, [], [], []
    lower = {}  # dest in lower case: the dest that took it, for a case-insensitive disk (#691)
    for src in sorted(paths):
        bad = malformed(src)
        if bad:
            clashes.append("%s is not a plain path (%s)" % (src, bad))
            continue
        rule = classify(manifest, src)
        if rule is None:
            unlisted.append(src)
            continue
        if not rule["public"]:
            private.append(src)
            continue
        dest = src[len(overlay) + 1:] if overlay and src.startswith(overlay + "/") else src
        if dest in exported:
            clashes.append("%s and %s both export to %s" % (exported[dest], src, dest))
        elif dest.lower() in lower:
            clashes.append("%s and %s export to %s and %s, one file on a case-insensitive disk"
                           % (exported[lower[dest.lower()]], src, lower[dest.lower()], dest))
        lower.setdefault(dest.lower(), dest)
        # A path that is private in another letter case lands on the private
        # file on a case-insensitive disk (macOS, Windows): a clash.
        variant = classify(manifest, dest, any_case=True)
        if variant is not None and not variant["public"] and not (dest != src and dest in manifest.get("overlay_replaces", [])):
            clashes.append("%s exports to %s, a case variant of a private path (%s)" % (src, dest, variant["reason"]))
        if dest != src:
            # An overlay file lands at dest. It may replace a private path only
            # when dest is on overlay_replaces (the internal root docs).
            target = classify(manifest, dest)
            if target is not None and not target["public"] and dest not in manifest.get("overlay_replaces", []):
                clashes.append("%s would export over the private path %s (%s)" % (src, dest, target["reason"]))
        exported[dest] = src
    return exported, private, unlisted, sorted(set(clashes))


def git(args, repo=REPO):
    """A git command's stdout as bytes; raises InfraError when git fails."""
    try:
        proc = subprocess.run(["git", "-C", repo] + args, capture_output=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as exc:
        raise InfraError("git could not run (%s)" % exc)
    if proc.returncode != 0:
        raise InfraError("git %s exited %d: %s" % (args[0], proc.returncode, proc.stderr.decode()[:200]))
    return proc.stdout


def tracked(ref, repo=REPO):
    """Every path tracked at ref."""
    return [p for p in git(["ls-tree", "-r", "-z", "--name-only", ref], repo).decode().split("\0") if p]


def counts(paths, exported, private):
    """Rows of (folder, public, private) by top-level folder."""
    public_src = set(exported.values())
    table = collections.OrderedDict()
    for src in sorted(paths):
        top = src.split("/", 1)[0] + ("/" if "/" in src else "")
        row = table.setdefault(top, [0, 0])
        if src in public_src:
            row[0] += 1
        elif src in private:
            row[1] += 1
    return [(k, v[0], v[1]) for k, v in table.items()]


def safe_out(out, repo=REPO):
    """The --out folder made absolute; raises InfraError inside the repo or when not empty."""
    out = os.path.abspath(out)
    root = os.path.realpath(repo)
    if os.path.realpath(out) == root or os.path.realpath(out).startswith(root + os.sep):
        raise InfraError("--out %s is inside the repo; export into a scratch folder" % out)
    if os.path.exists(out) and os.listdir(out):
        raise InfraError("--out %s is not empty" % out)
    os.makedirs(out, exist_ok=True)
    return out


def write_tree(manifest, ref, exported, out, repo=REPO):
    """Writes every exported file from REF's tree into out. Regular files only."""
    by_src = {src: dest for dest, src in exported.items()}
    proc = subprocess.Popen(["git", "-C", repo, "archive", "--format=tar", ref], stdout=subprocess.PIPE)
    written = 0
    try:
        with tarfile.open(fileobj=proc.stdout, mode="r|") as tar:
            for member in tar:
                dest = by_src.get(member.name)
                if dest is None:
                    continue
                if not member.isfile():
                    raise InfraError("%s is not a regular file; the export copies files only" % member.name)
                target = os.path.join(out, dest)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with open(target, "wb") as fh:
                    shutil.copyfileobj(tar.extractfile(member), fh)
                os.chmod(target, member.mode & 0o755)
                written += 1
    finally:
        proc.stdout.close()
        if proc.wait() != 0:
            raise InfraError("git archive %s exited %d" % (ref, proc.returncode))
    if written != len(exported):
        raise InfraError("wrote %d of %d files" % (written, len(exported)))
    lines = manifest.get("public_gitignore") or []
    if lines:
        with open(os.path.join(out, ".gitignore"), "a", encoding="utf-8") as fh:
            fh.write("\n" + "\n".join(lines) + "\n")
    return written


def report(paths, exported, private, unlisted, clashes):
    """Print the per-folder counts and every unlisted path and clash; returns the exit code."""
    print("| Folder | Public | Private |")
    print("| --- | --- | --- |")
    for folder, pub, priv in counts(paths, exported, private):
        print("| `%s` | %d | %d |" % (folder, pub, priv))
    print("export: %d tracked, %d public, %d private, %d unlisted, %d clashes"
          % (len(paths), len(exported), len(private), len(unlisted), len(clashes)))
    for src in unlisted:
        print("unlisted (matches no rule): %s" % src)
    for msg in clashes:
        print("clash: %s" % msg)
    return EXIT_FAIL if unlisted or clashes else EXIT_OK


def self_test(manifest):
    """Check the manifest's samples and a throwaway export; returns the exit code."""
    wrong = []
    samples = manifest.get("samples", {})
    for path in samples.get("public", []):
        rule = classify(manifest, path)
        if not rule or not rule["public"]:
            wrong.append("%s should be public" % path)
    for path in samples.get("private", []):
        rule = classify(manifest, path)
        if not rule or rule["public"]:
            wrong.append("%s should be private" % path)
    for path in samples.get("unlisted", []):
        if classify(manifest, path) is not None:
            wrong.append("%s should match no rule" % path)
    overlay = samples.get("overlay", {})
    exported, _, unlisted, _ = plan(manifest, list(overlay))
    for src, dest in overlay.items():
        if exported.get(dest) != src:
            wrong.append("overlay %s should export to %s" % (src, dest))
    _, _, _, clashes = plan(manifest, ["site/x.txt", manifest["overlay"] + "/site/x.txt"])
    if not clashes:
        wrong.append("an overlay file over a public file did not clash")
    # #691: a second spelling of a path, and two public paths one case apart.
    for path in ("site/x./a.txt", "site/x /a.txt", "site/a.txt.", "site/a:b.txt", "site/\u0430.txt"):
        if not malformed(path):
            wrong.append("%r passed as a plain path" % path)
    for path in ("site/a.txt", ".github/workflows/x.yml", "site/.well-known/a.txt"):
        if malformed(path):
            wrong.append("%r was refused as malformed" % path)
    if not any("case-insensitive" in c for c in plan(manifest, ["site/Readme.txt", "site/README.txt"])[3]):
        wrong.append("two public paths one case apart did not clash")
    for path in samples.get("overlay_clash", []):
        if not plan(manifest, [path])[3]:
            wrong.append("overlay file %s exported over a private path with no clash" % path)
    if not samples.get("overlay_clash"):
        wrong.append("no overlay_clash samples")
    # A manifest whose rule says "false" as a string, or has a blank reason, is refused.
    tmpdir = tempfile.mkdtemp(prefix="cs-export-manifest-")
    try:
        good = {"glob": "x/**", "public": False, "reason": "r"}
        for label, rule, extra in (('public "false" as a string', {"glob": "x/**", "public": "false", "reason": "r"}, {}),
                                   ("a blank reason", {"glob": "x/**", "public": False, "reason": "  "}, {}),
                                   ("overlay_replaces naming a private data path", good,
                                    {"overlay_replaces": ["README.md", "data/team/people.yaml"]})):
            bad = os.path.join(tmpdir, "m.json")
            with open(bad, "w", encoding="utf-8") as fh:
                json.dump(dict({"rules": [rule]}, **extra), fh)
            try:
                load_manifest(bad)
                wrong.append("a manifest with %s loaded" % label)
            except InfraError:
                pass
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    # End to end, in a throwaway repo: a private file never reaches the tree.
    tmp = tempfile.mkdtemp(prefix="cs-export-selftest-")
    try:
        src, out = os.path.join(tmp, "src"), os.path.join(tmp, "out")
        files = {"site/a.txt": "public\n", "data/team/people.yaml": "- id: real\n",
                 manifest["overlay"] + "/README.md": "# Public\n", ".gitignore": "node_modules/\n"}
        for rel, text in files.items():
            os.makedirs(os.path.dirname(os.path.join(src, rel)) or src, exist_ok=True)
            with open(os.path.join(src, rel), "w", encoding="utf-8") as fh:
                fh.write(text)
        quiet = ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
                 "-c", "user.name=self-test", "-c", "user.email=self-test@example.invalid"]
        subprocess.run(["git", "init", "-q", src], check=True, capture_output=True)
        subprocess.run(["git", "-C", src] + quiet + ["add", "-A"], check=True, capture_output=True)
        subprocess.run(["git", "-C", src] + quiet + ["commit", "-q", "-m", "x"], check=True, capture_output=True)
        paths = tracked("HEAD", src)
        exported, private, unlisted, clashes = plan(manifest, paths)
        write_tree(manifest, "HEAD", exported, safe_out(out, src), src)
        got = sorted(os.path.relpath(os.path.join(d, f), out) for d, _, fs in os.walk(out) for f in fs)
        if got != [".gitignore", "README.md", "site/a.txt"]:
            wrong.append("end to end wrote %s" % got)
        with open(os.path.join(out, ".gitignore"), encoding="utf-8") as fh:
            if "data/team/people.yaml" not in fh.read():
                wrong.append("end to end: .gitignore lacks the public_gitignore lines")
        try:
            safe_out(out, src)
            wrong.append("a non-empty --out was accepted")
        except InfraError:
            pass
        try:
            safe_out(os.path.join(src, "inside"), src)
            wrong.append("an --out inside the repo was accepted")
        except InfraError:
            pass
    except (OSError, subprocess.CalledProcessError) as exc:
        raise InfraError("self-test could not build its throwaway repo (%s)" % exc)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    for msg in wrong:
        print("self-test: %s" % msg)
    print("export_public self-test: %s" % ("FAIL" if wrong else "PASS"))
    return EXIT_FAIL if wrong else EXIT_OK


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        print("usage error: %s" % message, file=sys.stderr)
        self.print_usage(sys.stderr)
        sys.exit(EXIT_USAGE)


def main(argv=None):
    """Run the command line; returns the exit code."""
    parser = _Parser(description="build the public tree from the export manifest")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="classify every path and print counts")
    mode.add_argument("--out", metavar="DIR", help="write the public tree into DIR (outside the repo, empty)")
    mode.add_argument("--self-test", action="store_true", help="run the manifest's samples and a throwaway export")
    parser.add_argument("--ref", default="HEAD", help="git ref to export (default HEAD)")
    parser.add_argument("--list", metavar="FILE", help="with --out: write the exported paths to FILE")
    parser.add_argument("--manifest", default=MANIFEST, help="manifest file (default export_manifest.json)")
    args = parser.parse_args(argv)
    try:
        manifest = load_manifest(args.manifest)
        if args.self_test:
            return self_test(manifest)
        paths = tracked(args.ref)
        exported, private, unlisted, clashes = plan(manifest, paths)
        code = report(paths, exported, private, unlisted, clashes)
        if code != EXIT_OK or args.check:
            return code
        written = write_tree(manifest, args.ref, exported, safe_out(args.out))
        if args.list:
            with open(args.list, "w", encoding="utf-8") as fh:
                fh.write("\n".join(sorted(exported)) + "\n")
        print("export: wrote %d files to %s (nothing pushed)" % (written, args.out))
        return EXIT_OK
    except InfraError as exc:
        print("could not check: %s" % exc, file=sys.stderr)
        return EXIT_INFRA


if __name__ == "__main__":
    sys.exit(main())
