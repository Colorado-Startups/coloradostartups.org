#!/usr/bin/env python3
"""package_age.py: is every package version a lockfile change adds old enough?

Decision 12 pins releases at least 14 days old; decision 89 lets a security
fix pin one at least 7 days old. A version counts as a security fix only when
the change drops a base version of that package that an npm advisory covers,
and npm's bulk advisory endpoint (the one `npm audit` calls) flags nothing in
the new version. `npm audit` runs beside this in CI for the rest.

Reads the base lockfile from git (REF:package-lock.json) and the head one from
disk, both lockfile v2 or later, one entry per lockfile path. Every entry the
head adds or changes must resolve to the registry's own tarball for its exact
name@version (<registry>/<name>/-/<bare name>-<version>.tgz); any other
`resolved`, or none, fails, even for a version the base already held. This
repo's own code is skipped only where the lockfile proves it: a workspace
the root declares, a link to one, and an inBundle entry its parent's
bundleDependencies names. Each version new to the tree is judged by its
packument's `time` entry; a version with none fails too.

Usage:
  python3 -I 04_tools/package_age.py --base REF [--lock package-lock.json]
  python3 -I 04_tools/package_age.py --self-test

Exit codes (04_tools/README.md, Exit contract):
  0  every added version is old enough, or nothing was added
  1  a version is younger than its floor, has no publish time, or is not from
     the registry
  2  usage error
  3  could not check: no base lockfile, a lockfile before v2, the registry
     unreachable

Python 3.9 or later, standard library only.
"""

import argparse
import fnmatch
import http.client
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

MIN_DAYS = 14  # decision 12
SECURITY_DAYS = 7  # decision 89
REGISTRY = "https://registry.npmjs.org"


class CouldNotCheck(Exception):
    pass


def entries(lock):
    """{(name, version, resolved)} for every installed package in a lockfile
    v2/v3 `packages` map, one per path, so two paths never overwrite each
    other. This repo's own code is left out, but only where the lockfile
    proves it: the root, a workspace the root declares, a link to one, and a
    bundled dependency (inBundle) whose parent's bundleDependencies names it,
    since it ships inside that parent's tarball. Any other workspace path,
    link or inBundle entry keeps a `resolved` that says why, so the source
    check fails it."""
    version = lock.get("lockfileVersion")
    if not isinstance(version, int) or version < 2:
        raise CouldNotCheck(f"lockfileVersion {version!r}: this check reads the v2 or later `packages` map")
    packages = lock.get("packages") or {}
    declared = (packages.get("") or {}).get("workspaces") or []
    if isinstance(declared, dict):
        declared = declared.get("packages") or []
    workspace = lambda path: any(fnmatch.fnmatchcase(path, glob.rstrip("/")) for glob in declared)  # noqa: E731
    out = set()
    for key, entry in packages.items():
        name = entry.get("name") or key.rsplit("node_modules/", 1)[-1]
        if "node_modules/" not in key:
            if key and not workspace(key):
                out.add((name, entry.get("version"), f"workspace path {key}, which the root's workspaces do not declare"))
            continue
        if entry.get("link"):
            if not workspace(str(entry.get("resolved"))):
                out.add((name, entry.get("version"), f"a link to {entry.get('resolved')}, not a declared workspace"))
            continue
        if entry.get("inBundle"):
            if not bundled_by_parent(packages, key):
                out.add((name, entry.get("version"), "inBundle, but no parent's bundleDependencies names it"))
            continue
        out.add((name, entry.get("version"), entry.get("resolved")))
    return out


def bundled_by_parent(packages, key):
    """True when the nearest ancestor with bundleDependencies lists the
    package right under it on this path (or bundles all, `true`)."""
    segs = re.split(r"(?:^|/)node_modules/", key)[1:]
    for depth in range(len(segs) - 1, 0, -1):
        parent = packages.get("node_modules/" + "/node_modules/".join(segs[:depth])) or {}
        listed = parent.get("bundleDependencies", parent.get("bundledDependencies"))
        if listed:
            return listed is True or segs[depth] in listed
    return False


def tarball(name, version):
    """The registry's own tarball URL for name@version: the scope stays in the
    path, and the file is the bare name."""
    return f"{REGISTRY}/{name}/-/{name.rsplit('/', 1)[-1]}-{version}.tgz"


def held_by_name(found):
    """Every version held per package name."""
    held = {}
    for name, version, _ in found:
        held.setdefault(name, set()).add(version)
    return held


def check(base, head, now, published, advised):
    """Findings for each version the head adds. published(name, version)
    returns a datetime or None; advised(name, versions) says whether an
    advisory covers any of them. Both raise CouldNotCheck."""
    old, new = entries(base), entries(head)
    base_held, head_held = held_by_name(old), held_by_name(new)
    findings = []
    for name, version, resolved in sorted(new - old, key=lambda e: (e[0], str(e[1]), str(e[2]))):
        # The source first, so an old version with a swapped `resolved` is
        # still read: only the registry's own tarball for that exact version.
        if not version or resolved != tarball(name, version):
            findings.append(f"{name}@{version} comes from {resolved or 'no resolved source'}, not the npm registry's {tarball(name, version or '?')}")
            continue
        if version in base_held.get(name, set()):
            continue  # this version, from the registry, was already in the tree
        when = published(name, version)
        if when is None:
            findings.append(f"{name}@{version} has no publish time in the registry")
            continue
        days = (now - when) / timedelta(days=1)
        if days >= MIN_DAYS:
            continue
        gone = sorted(base_held.get(name, set()) - head_held.get(name, set()))
        fix = days >= SECURITY_DAYS and bool(gone) and advised(name, gone) and not advised(name, [version])
        if not fix:
            floor = f"{SECURITY_DAYS} for a security fix, else {MIN_DAYS}" if days >= SECURITY_DAYS else str(SECURITY_DAYS)
            findings.append(f"{name}@{version} is {days:.1f} days old; the floor is {floor} (decisions 12 and 89)")
    return findings


def _get(url, data=None):
    req = urllib.request.Request(url, data=data, headers={"Accept": "application/json", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except (OSError, ValueError, http.client.HTTPException) as err:
        raise CouldNotCheck(f"{url}: {err}") from err


def registry_published(name, version, _cache={}):
    """When the npm registry says this version was published, or None."""
    if name not in _cache:
        _cache[name] = _get(f"{REGISTRY}/{urllib.parse.quote(name, safe='@')}").get("time") or {}
    stamp = _cache[name].get(version)
    try:
        return datetime.fromisoformat(stamp.replace("Z", "+00:00")) if stamp else None
    except ValueError:
        return None


def registry_advised(name, versions):
    """Whether the npm registry has an advisory for any of these versions."""
    body = json.dumps({name: versions}).encode()
    return bool(_get(f"{REGISTRY}/-/npm/v1/security/advisories/bulk", body).get(name))


def self_test():
    """Check the age and advisory rules on seeded lockfiles; returns the exit code."""
    now = datetime(2026, 11, 4, tzinfo=timezone.utc)
    ages = {"old": 30, "young": 3, "fix": 9, "fix-early": 5, "still-bad": 9}
    published = lambda name, version: None if version == "no-time" else now - timedelta(days=ages[version])  # noqa: E731
    advised = lambda name, versions: name == "vuln" and any(v in ("old", "still-bad") for v in versions)  # noqa: E731

    def lock(*pkgs, version=3, site="0.0.0"):
        packages = {"": {"name": "root", "workspaces": ["site"]}, "site": {"name": "@cs/site", "version": site}, "node_modules/@cs/site": {"resolved": "site", "link": True}}
        for path, ver, *src in pkgs:
            name = path.rsplit("node_modules/", 1)[-1]
            entry = {"version": ver, "resolved": src[0] if src else tarball(name, ver)}
            if src and src[0] is None:
                del entry["resolved"]
            packages[f"node_modules/{path}"] = entry
        return {"lockfileVersion": version, "packages": packages}

    base = lock(("a", "old"), ("vuln", "old"), ("plain", "old"))
    def with_entries(extra, parent=None):
        head = lock(("a", "old"), ("vuln", "old"), ("plain", "old"))
        head["packages"].update(extra)
        if parent is not None:
            head["packages"]["node_modules/a"]["bundleDependencies"] = parent
        return head

    z = {"node_modules/a/node_modules/z": {"version": "1.0.0", "inBundle": True}}
    bundled = with_entries(z, parent=["z"])
    cases = [
        ("clean: a 30-day-old version", lock(("a", "old"), ("b", "old")), 0),
        ("unchanged lockfile", base, 0),
        ("a workspace's own version bump", lock(("a", "old"), ("vuln", "old"), ("plain", "old"), site="0.0.1"), 0),
        ("bad: a 3-day-old version", lock(("a", "old"), ("b", "young")), 1),
        ("bad: a nested 3-day-old version", lock(("a", "old"), ("a/node_modules/c", "young")), 1),
        ("security fix at 9 days, the advised version gone", lock(("a", "old"), ("vuln", "fix")), 0),
        ("security fix at 5 days", lock(("a", "old"), ("vuln", "fix-early")), 1),
        ("9 days, the advised base version kept", lock(("a", "old"), ("vuln", "old"), ("x/node_modules/vuln", "fix")), 1),
        ("9 days, the new version still advised", lock(("a", "old"), ("vuln", "still-bad")), 1),
        ("9 days with no advisory on the old version", lock(("a", "old"), ("plain", "fix")), 1),
        ("a new package at 9 days is no fix", lock(("a", "old"), ("vuln", "old"), ("newpkg", "fix")), 1),
        ("bad: a git source", lock(("a", "old"), ("g", "old", "git+ssh://git@github.com/x/g.git#abc")), 1),
        ("bad: another host's tarball", lock(("a", "old"), ("t", "old", "https://example.com/t-1.0.0.tgz")), 1),
        ("bad: no resolved source", lock(("a", "old"), ("n", "old", None)), 1),
        ("bad: no publish time", lock(("a", "old"), ("b", "no-time")), 1),
        ("bad: an old version swapped to a git source", lock(("a", "old", "git+ssh://git@github.com/x/a.git#abc"), ("vuln", "old"), ("plain", "old")), 1),
        ("bad: an old version carrying a young release's tarball", lock(("a", "old", tarball("a", "young")), ("vuln", "old"), ("plain", "old")), 1),
        ("bad: a second path of an old version from another host", lock(("a", "old"), ("vuln", "old"), ("plain", "old"), ("x/node_modules/a", "old", "https://example.com/a-old.tgz")), 1),
        ("a second path of an old version from the registry", lock(("a", "old"), ("vuln", "old"), ("plain", "old"), ("x/node_modules/a", "old")), 0),
        ("a bundled dependency, which ships inside its parent", bundled, 0),
        ("a bundled dependency under bundleDependencies true", with_entries(z, parent=True), 0),
        ("bad: inBundle with no parent bundleDependencies", with_entries(z), 1),
        ("bad: inBundle that the parent's list does not name", with_entries(z, parent=["other"]), 1),
        ("bad: a link to a path no workspace declares", with_entries({"node_modules/evil": {"resolved": "../evil", "link": True}}), 1),
        ("bad: a workspace path the root does not declare", with_entries({"tools/evil": {"name": "evil", "version": "1.0.0"}}), 1),
        ("a scoped package's registry tarball", lock(("a", "old"), ("vuln", "old"), ("plain", "old"), ("@s/p", "old")), 0),
    ]
    wrong = 0
    for label, head, want in cases:
        got = len(check(base, head, now, published, advised))
        ok = (got > 0) == (want == 1)
        wrong += not ok
        print(f"  {'OK  ' if ok else 'FAIL'} {label}: {got} finding(s)")

    def unreachable(name, version):
        raise CouldNotCheck("offline")

    for label, args in [
        ("an unreachable registry", (base, lock(("b", "young")), now, unreachable, advised)),
        ("a lockfile v1", (base, {"lockfileVersion": 1, "dependencies": {}}, now, published, advised)),
    ]:
        try:
            check(*args)
            print(f"  FAIL {label} must be could-not-check")
            wrong += 1
        except CouldNotCheck:
            print(f"  OK   {label} is could-not-check, never clean")
    print(f"package_age self-test: {'PASS' if not wrong else 'FAIL'}")
    return 1 if wrong else 0


def main(argv):
    """Run the command line; returns the exit code."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base", help="git ref whose package-lock.json is the base")
    ap.add_argument("--lock", default="package-lock.json", help="head lockfile path (default package-lock.json)")
    ap.add_argument("--self-test", action="store_true")
    try:
        args = ap.parse_args(argv)
    except SystemExit:
        return 2
    if args.self_test:
        return self_test()
    if not args.base:
        print("usage: package_age.py --base REF [--lock FILE] | --self-test", file=sys.stderr)
        return 2
    try:
        shown = subprocess.run(["git", "show", f"{args.base}:package-lock.json"], capture_output=True, text=True, check=False)
        if shown.returncode != 0:
            raise CouldNotCheck(f"git show {args.base}:package-lock.json: {shown.stderr.strip()}")
        base = json.loads(shown.stdout)
        with open(args.lock, encoding="utf-8") as fh:
            head = json.load(fh)
        added = len(entries(head) - entries(base))
        findings = check(base, head, datetime.now(timezone.utc), registry_published, registry_advised)
    except (CouldNotCheck, OSError, ValueError) as err:
        print(f"package_age: could not check: {err}", file=sys.stderr)
        return 3
    for f in findings:
        print(f"FAIL {f}")
    print(f"package_age: {added} added version(s), {len(findings)} failing")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
