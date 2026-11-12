#!/usr/bin/env python3
"""Seed a new worktree's node_modules with an APFS clone (decision 74).

Each Claude Code worktree of this repo used to run its own npm ci, which
writes a private node_modules of about 800 MB (du on the main checkout,
2026-10-18). On APFS a clone shares its data blocks with its source until
one side writes, so a cloned node_modules costs only file metadata: 8 to
21 MB per clone (df across three clones, 2026-10-18).

The seed is one reconciled node_modules in the shared git directory, at
.git/cs-deps-seed/current, beside copies of the manifests it was installed
from: package.json, package-lock.json, .npmrc if any, and each workspace's
package.json. Only this script writes it.

- The worktree's manifests match the seed's: one clonefile(2) call copies
  the seed into the worktree. That took 1.1 s on 2026-10-18.
- They differ, and match origin/main's byte for byte: build a new seed
  first. Clone the old seed (the first time, the main checkout's
  node_modules) into a build folder that holds those manifests, and let
  `npm install --no-save` reconcile it. Only changed packages get new
  blocks. The new seed replaces the old one, then the worktree clones it.
- They differ from both: no automatic install, and one INFO line. A seed
  build runs install scripts, so only origin/main's reviewed manifests may
  trigger one. The session runs npm ci itself, as before.

It never touches an existing node_modules, the main checkout's files or
another worktree. Anything it cannot do (not macOS, not APFS, npm fails, a
permission error) prints one INFRA line and exits 3, with no traceback,
because SessionStart output lands in the model's context. The hook carries
on, and the session installs as before.

A node_modules that is already there gets a check instead, in a worktree or
in the main checkout, and is still never written. Every package path in the
checkout's package-lock.json must hold a package.json at the locked
version, and every workspace link must point at its workspace. A package
that is missing, or at another version, gets one INFO line that names the
fix: npm install --no-audit --no-fund. Never npm ci, which deletes a cloned
node_modules and writes a full private copy. A missing optional package
passes, because npm does not install one built for another platform.
Packages the lockfile no
longer names are not reported, since they cannot break an import. A
lockfile it cannot read prints one INFRA line and exits 3, never a pass.

The check reads each installed package.json, not npm's hidden lockfile
node_modules/.package-lock.json. Node loads the package.json files. npm
itself ignores the hidden lockfile once another tool has changed the tree,
and a hand edit can leave it out of date (npm docs, package-lock.json, read
2026-11-02). Reading 542 package.json files took 0.13 s here (2026-11-02).

The hook needs the folder the session works in. CLAUDE_PROJECT_DIR stays at
the project root where the session started (hooks docs, read 2026-11-02).
In an app-created worktree it named the main checkout (issue #382). The cwd
field of the hook's JSON input follows the session into its worktree, and
after a cd (the same docs). --session-dir reads that input and prints the
top of the first checkout among cwd, CLAUDE_PROJECT_DIR and the current
directory, preferring one with .githooks/. It waits at most
SESSION_INPUT_WAIT_S for stdin, so a terminal or an idle pipe never blocks
the hook. It prints nothing when no candidate is a git checkout.

.claude/hooks/cs-site-session-start.sh routes to this script, so it fires at
session start. By hand, from inside a worktree:

  python3 -I scripts/worktree_deps.py                seed or check this worktree
  python3 -I scripts/worktree_deps.py --measure      du beside clone-aware size
  python3 -I scripts/worktree_deps.py --self-test    known-good and known-bad samples
  python3 -I scripts/worktree_deps.py --session-dir  the folder a hook input names

du cannot see clones: it counts every cloned block again. --measure also sums
each file's private size (getattrlist ATTR_CMNEXT_PRIVATESIZE), which is what
deleting the file would free.

Exit codes follow 04_tools/README.md: 0 done, nothing to do or INFO, 1
self-test failure, 2 usage error, 3 could not seed or check. Seeding,
--measure and --self-test need macOS and APFS, so off macOS they exit 3.
The check and --session-dir run anywhere.
"""

import contextlib
import ctypes
import fcntl
import fnmatch
import glob
import io
import json
import os
import select
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time

PREFIX = "cs-site deps:"
SEED_DIR = "cs-deps-seed"
MAIN_REF = "origin/main"
NPM_ARGS = ["install", "--no-save", "--prefer-offline", "--no-audit", "--no-fund", "--loglevel=error"]
# Claude Code kills a command hook after 600 s (hooks docs, read 2026-10-18).
# Waiting for another build plus our own build stays under that.
LOCK_WAIT_S = 150
NPM_TIMEOUT_S = 400
# Claude Code writes the hook input as the hook starts. A terminal or an idle
# pipe sends none, so --session-dir stops waiting after this.
SESSION_INPUT_WAIT_S = 1.0
SESSION_INPUT_MAX = 1024 * 1024
# The fix for a node_modules that differs from its lockfile. npm ci would
# delete a cloned node_modules and write a full private copy (decision 74).
NPM_FIX = "npm install --no-audit --no-fund"
CHECK_WHAT = "check node_modules against package-lock.json"
CHECK_ADVICE = " node_modules was left alone. If a build cannot find a package, run %s." % NPM_FIX

CLONE_NOFOLLOW = 0x1
ATTR_BIT_MAP_COUNT = 5
ATTR_CMNEXT_PRIVATESIZE = 0x8
FSOPT_NOFOLLOW = 0x1
FSOPT_ATTR_CMN_EXTENDED = 0x20
MIB = 1024 * 1024


class Infra(Exception):
    """Could not seed, check or measure. Reported as one INFRA line, exit 3.

    what and advice, when given, replace main()'s wording for that line.
    """

    def __init__(self, msg, what=None, advice=None):
        Exception.__init__(self, msg)
        self.what = what
        self.advice = advice


def say(msg):
    print("%s %s" % (PREFIX, " ".join(str(msg).split())), flush=True)


# ---------------------------------------------------------------- macOS calls

class _AttrList(ctypes.Structure):
    _fields_ = [("bitmapcount", ctypes.c_ushort), ("reserved", ctypes.c_uint16),
                ("commonattr", ctypes.c_uint32), ("volattr", ctypes.c_uint32),
                ("dirattr", ctypes.c_uint32), ("fileattr", ctypes.c_uint32),
                ("forkattr", ctypes.c_uint32)]


_LIBC = []


def libc():
    if not _LIBC:
        if sys.platform != "darwin":
            raise Infra("not macOS, so no APFS clones")
        lib = ctypes.CDLL("libc.dylib", use_errno=True)
        lib.clonefile.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint32]
        lib.getattrlist.argtypes = [ctypes.c_char_p, ctypes.c_void_p, ctypes.c_void_p,
                                    ctypes.c_size_t, ctypes.c_uint]
        _LIBC.append(lib)
    return _LIBC[0]


def clone_tree(src, dst):
    """Clone directory src to dst, which must not exist, in one call.

    clonefile(2) is atomic: every object is created or none is, so a killed
    run never leaves a half tree. Its man page prefers copyfile(3) for whole
    directories; `cp -c -R`, which clones file by file, took 4 min 25 s here
    under load on 2026-10-18, against 1.1 s for this call.
    """
    if os.path.islink(src) or not os.path.isdir(src):
        raise Infra("%s is not a real directory" % src)
    if libc().clonefile(os.fsencode(src), os.fsencode(dst), CLONE_NOFOLLOW) != 0:
        raise Infra("clonefile to %s failed: %s" % (dst, os.strerror(ctypes.get_errno())))


def private_bytes(path):
    """Bytes deleting path would free: blocks not shared with a clone or snapshot."""
    req = _AttrList(ATTR_BIT_MAP_COUNT, 0, 0, 0, 0, 0, ATTR_CMNEXT_PRIVATESIZE)
    buf = ctypes.create_string_buffer(16)
    if libc().getattrlist(os.fsencode(path), ctypes.byref(req), buf, len(buf),
                          FSOPT_NOFOLLOW | FSOPT_ATTR_CMN_EXTENDED) != 0:
        raise Infra("getattrlist %s failed: %s" % (path, os.strerror(ctypes.get_errno())))
    # The reply is a u_int32 length, then the off_t private size.
    return int.from_bytes(buf.raw[4:12], "little", signed=True)


def tree_size(root):
    """(regular files, bytes du counts, private bytes) under root."""
    files = counted = private = 0
    for d, _dirs, names in os.walk(root):
        for n in names:
            p = os.path.join(d, n)
            st = os.lstat(p)
            if stat.S_ISREG(st.st_mode):
                files += 1
                counted += st.st_blocks * 512
                private += private_bytes(p)
    return files, counted, private


# ---------------------------------------------------------------- manifests

def git(cwd, *args):
    r = subprocess.run(["git", "-C", cwd] + list(args), capture_output=True, text=True)
    if r.returncode != 0:
        raise Infra("git %s failed: %s" % (" ".join(args), r.stderr.strip()[:200]))
    return r.stdout.strip()


def safe_rel(rel):
    """rel, normalized, if it stays inside the folder it is relative to."""
    norm = os.path.normpath(rel)
    if os.path.isabs(norm) or norm == ".." or norm.startswith(".." + os.sep):
        raise Infra("workspace path %r leaves the repository" % rel)
    return norm


def workspace_patterns(package_json):
    try:
        pkg = json.loads(package_json)
    except ValueError as exc:
        raise Infra("package.json is not JSON (%s)" % exc)
    if not isinstance(pkg, dict):
        raise Infra("package.json is not a JSON object")
    patterns = pkg.get("workspaces") or []
    if isinstance(patterns, dict):
        patterns = patterns.get("packages") or []
    if not isinstance(patterns, list) or not all(isinstance(p, str) for p in patterns):
        raise Infra("package.json workspaces is not a list of paths")
    return patterns


def manifests(root):
    """{relative path: bytes} for every file npm reads to plan the install."""
    def read(rel):
        with open(os.path.join(root, rel), "rb") as f:
            return f.read()
    try:
        out = {"package.json": read("package.json"), "package-lock.json": read("package-lock.json")}
        if os.path.isfile(os.path.join(root, ".npmrc")):
            out[".npmrc"] = read(".npmrc")
        for pattern in workspace_patterns(out["package.json"]):
            safe_rel(pattern)
            for d in sorted(glob.glob(os.path.join(root, pattern))):
                rel = safe_rel(os.path.relpath(os.path.join(d, "package.json"), root))
                if os.path.isfile(os.path.join(root, rel)):
                    out[rel] = read(rel)
    except OSError as exc:
        raise Infra("cannot read the manifests in %s (%s)" % (root, exc))
    return out


def main_manifests(top):
    """The same manifest set as manifests(), read from origin/main, or None.

    None means origin/main is missing or its workspaces use a pattern this
    script does not expand; either way the worktree does not count as main.
    """
    if subprocess.run(["git", "-C", top, "rev-parse", "--verify", "--quiet", MAIN_REF + "^{commit}"],
                      capture_output=True).returncode != 0:
        return None

    def show(rel):
        r = subprocess.run(["git", "-C", top, "show", "%s:%s" % (MAIN_REF, rel)], capture_output=True)
        return r.stdout if r.returncode == 0 else None

    files = subprocess.run(["git", "-C", top, "ls-tree", "-r", "-z", "--name-only", MAIN_REF],
                           capture_output=True)
    if files.returncode != 0:
        return None
    tree = set(files.stdout.decode("utf-8", "surrogateescape").split("\0"))
    out = {}
    for rel in ("package.json", "package-lock.json", ".npmrc"):
        if rel in tree:
            out[rel] = show(rel)
            if out[rel] is None:
                return None
    if "package.json" not in out or "package-lock.json" not in out:
        return None
    for pattern in workspace_patterns(out["package.json"]):
        if "**" in pattern:
            return None
        parts = safe_rel(pattern).split(os.sep)
        for path in sorted(tree):
            segs = path.split("/")
            if segs[-1] == "package.json" and len(segs) == len(parts) + 1 \
                    and all(fnmatch.fnmatchcase(s, p) for s, p in zip(segs, parts)):
                out[path] = show(path)
                if out[path] is None:
                    return None
    return out


def module_dirs(want):
    """node_modules folders an install can create: the root and each workspace."""
    return ["node_modules"] + [os.path.join(os.path.dirname(rel), "node_modules")
                               for rel in sorted(want) if rel.endswith("/package.json")]


# ---------------------------------------------------------------- the check

def drift(top):
    """Where top's node_modules differs from top's package-lock.json.

    Returns (missing, other): missing lists package paths with no package
    there; other lists (path, installed, locked) for one at another version
    or a link to another folder. Raises Infra when it cannot tell.
    """
    def cannot(why):
        return Infra(why, what=CHECK_WHAT, advice=CHECK_ADVICE)
    try:
        with open(os.path.join(top, "package-lock.json"), "rb") as f:
            lock = json.loads(f.read())
    except OSError as exc:
        raise cannot("cannot read package-lock.json (%s)" % exc)
    except ValueError as exc:
        raise cannot("package-lock.json is not JSON (%s)" % exc)
    packages = lock.get("packages") if isinstance(lock, dict) else None
    if not isinstance(packages, dict):
        raise cannot("package-lock.json has no packages map, which npm 7 and later write")
    missing, other = [], []
    for key, entry in sorted(packages.items()):
        segs = key.split("/")
        if "node_modules" not in segs:
            continue  # the root package or a workspace folder, not an installed package
        if ".." in segs or key.startswith("/") or not isinstance(entry, dict):
            raise cannot("package-lock.json has an entry npm does not write: %r" % key)
        path = os.path.join(top, key)
        if entry.get("link"):
            want = os.path.realpath(os.path.join(top, str(entry.get("resolved") or "")))
            if not os.path.lexists(path):
                missing.append(key)
            elif os.path.realpath(path) != want:
                other.append((key, "a link to " + os.path.realpath(path),
                              "a link to %s" % entry.get("resolved")))
            continue
        try:
            with open(os.path.join(path, "package.json"), "rb") as f:
                raw = f.read()
        except (FileNotFoundError, NotADirectoryError):
            if not (entry.get("optional") or entry.get("devOptional")):
                missing.append(key)
            continue
        except OSError as exc:
            raise cannot("cannot read %s/package.json (%s)" % (key, exc))
        try:
            installed = json.loads(raw).get("version")
        except (ValueError, AttributeError):
            installed = "an unreadable package.json"
        locked = entry.get("version")
        if locked is not None and installed != locked:
            other.append((key, installed, locked))
    return missing, other


def report_drift(top):
    """Say one INFO line and return True when top's node_modules differs."""
    missing, other = drift(top)
    if not (missing or other):
        return False

    def some(items):
        return ", ".join(items[:3]) + (", and more" if len(items) > 3 else "")
    parts = []
    if missing:
        parts.append("%d missing (%s)" % (len(missing), some(missing)))
    if other:
        parts.append("%d at another version (%s)" % (
            len(other), some(["%s: %s installed, %s locked" % o for o in other])))
    say("INFO node_modules does not match package-lock.json: %s. It was left alone. "
        "Run %s, not npm ci, which deletes a cloned node_modules and writes a full private copy."
        % ("; ".join(parts), NPM_FIX))
    return True


# ---------------------------------------------------------------- the session folder

def hook_input_cwd():
    """The cwd field of the hook's JSON input on stdin, or None.

    Reads until end of input, SESSION_INPUT_MAX bytes or SESSION_INPUT_WAIT_S,
    whichever comes first. A terminal is never read.
    """
    if sys.stdin is None:
        return None
    fd = sys.stdin.fileno()
    if os.isatty(fd):
        return None
    chunks, size = [], 0
    deadline = time.monotonic() + SESSION_INPUT_WAIT_S
    while size < SESSION_INPUT_MAX:
        left = deadline - time.monotonic()
        if left <= 0 or not select.select([fd], [], [], left)[0]:
            break
        chunk = os.read(fd, 65536)
        if not chunk:
            break
        chunks.append(chunk)
        size += len(chunk)
    try:
        data = json.loads(b"".join(chunks).decode("utf-8"))
    except ValueError:
        return None
    cwd = data.get("cwd") if isinstance(data, dict) else None
    return cwd if isinstance(cwd, str) and os.path.isabs(cwd) else None


def session_dir():
    """Print the top of the checkout the session works in, or nothing.

    Candidates in order: the hook input's cwd, CLAUDE_PROJECT_DIR, the
    current directory. The first checkout with .githooks/ wins, else the
    first checkout. Never fails: the hook falls back on its own.
    """
    try:
        cwd = hook_input_cwd()
    except Exception:  # an odd stdin must not cost the fallbacks below
        cwd = None
    tops = []
    try:
        for cand in (cwd, os.environ.get("CLAUDE_PROJECT_DIR"), os.getcwd()):
            if not cand or not os.path.isdir(cand):
                continue
            r = subprocess.run(["git", "-C", cand, "rev-parse", "--show-toplevel"],
                               capture_output=True, text=True)
            top = r.stdout.strip() if r.returncode == 0 else ""
            if not top:
                continue
            if os.path.isdir(os.path.join(top, ".githooks")):
                tops.insert(0, top)
                break
            tops.append(top)
    except Exception:
        pass
    if tops:
        print(tops[0])
    return 0


# ---------------------------------------------------------------- the seed

@contextlib.contextmanager
def seed_lock(seed_root):
    os.makedirs(seed_root, exist_ok=True)
    fd = os.open(os.path.join(seed_root, "lock"), os.O_CREAT | os.O_RDWR, 0o644)
    try:
        deadline = time.monotonic() + LOCK_WAIT_S
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() > deadline:
                    raise Infra("another session is still building the seed")
                time.sleep(1)
        yield
    finally:
        os.close(fd)  # closing releases the lock


def build_seed(seed_root, current, want, main_modules):
    """Reconcile a new seed for `want` and swap it in. Returns where it started."""
    # We hold the lock, so any build- or old- folder is left from a killed run.
    for name in os.listdir(seed_root):
        if name.startswith(("build-", "old-")):
            shutil.rmtree(os.path.join(seed_root, name), ignore_errors=True)
    build = os.path.join(seed_root, "build-%d" % os.getpid())
    os.mkdir(build)
    try:
        for rel, data in want.items():
            path = os.path.join(build, safe_rel(rel))
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(data)
        start = "scratch"
        for label, base in (("the old seed", os.path.join(current, "node_modules")),
                            ("the main checkout", main_modules)):
            if base and os.path.isdir(base) and not os.path.islink(base):
                clone_tree(base, os.path.join(build, "node_modules"))
                start = label
                break
        # A hook may start without Homebrew on PATH. npm's shebang needs node,
        # which sits beside it, so its folder goes first on PATH.
        npm = os.environ.get("CS_DEPS_NPM") or shutil.which("npm") or "/opt/homebrew/bin/npm"
        env = dict(os.environ, PATH=os.path.dirname(npm) + os.pathsep + os.environ.get("PATH", ""))
        try:
            r = subprocess.run([npm] + NPM_ARGS, cwd=build, env=env, capture_output=True, text=True,
                               timeout=NPM_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            raise Infra("npm install ran past %d s" % NPM_TIMEOUT_S)
        except OSError as exc:
            raise Infra("could not run %s (%s)" % (npm, exc))
        if r.returncode != 0:
            last = (r.stderr or r.stdout).strip().splitlines()[-1:] or [""]
            raise Infra("npm install exited %d: %s" % (r.returncode, last[0][:200]))
        old = None
        if os.path.isdir(current):
            old = os.path.join(seed_root, "old-%d" % os.getpid())
            os.rename(current, old)
        os.rename(build, current)
    except BaseException:
        shutil.rmtree(build, ignore_errors=True)
        raise
    if old:
        shutil.rmtree(old, ignore_errors=True)
    return start


def seed(start_dir):
    top = git(start_dir, "rev-parse", "--show-toplevel")
    git_dir = git(start_dir, "rev-parse", "--path-format=absolute", "--git-dir")
    common = git(start_dir, "rev-parse", "--path-format=absolute", "--git-common-dir")
    target = os.path.join(top, "node_modules")
    if os.path.realpath(git_dir) == os.path.realpath(common):
        if not os.path.lexists(target):
            say("main checkout; nothing to seed")
        elif not report_drift(top):
            say("main checkout; node_modules matches package-lock.json; nothing to seed")
        return
    if os.path.lexists(target):
        if not report_drift(top):
            say("node_modules present and matches package-lock.json; left alone")
        return
    want = manifests(top)
    targets = module_dirs(want)
    main_top = os.path.dirname(common) if os.path.basename(common) == ".git" else None
    main_modules = os.path.join(main_top, "node_modules") if main_top else None
    seed_root = os.path.join(common, SEED_DIR)
    current = os.path.join(seed_root, "current")

    t0 = time.monotonic()
    with seed_lock(seed_root):
        # Checked again under the lock: npm or another session may have made
        # one while this run waited.
        if os.path.lexists(target):
            say("node_modules present; left alone")
            return
        in_the_way = [t for t in targets[1:] if os.path.lexists(os.path.join(top, t))]
        if in_the_way:
            raise Infra("%s already exists, so the seed would not fit; run npm install" % in_the_way[0])
        have = None
        if os.path.isdir(current):
            try:
                have = manifests(current)
            except Infra:
                have = None
        rebuilt = None
        if have != want:
            if main_manifests(top) != want:
                say("INFO no automatic install: this worktree's package.json or lockfile differs "
                    "from %s's, and only %s's reviewed manifests may build the seed, because a "
                    "build runs install scripts. Run npm ci." % (MAIN_REF, MAIN_REF))
                return
            rebuilt = build_seed(seed_root, current, want, main_modules)
        if not os.path.isdir(os.path.join(current, "node_modules")):
            raise Infra("the seed has no node_modules")
        made = []
        try:
            for rel in targets:
                if os.path.isdir(os.path.join(current, rel)):
                    clone_tree(os.path.join(current, rel), os.path.join(top, rel))
                    made.append(os.path.join(top, rel))
        except BaseException:
            # Never leave a half seed that the next session reads as present.
            for path in made:
                shutil.rmtree(path, ignore_errors=True)
            raise
    how = "rebuilt the seed from %s with npm install, then cloned it" % rebuilt if rebuilt \
        else "cloned the seed"
    say("%s into node_modules in %.1f s. It shares blocks with .git/%s/current; "
        "use npm install, not npm ci, which replaces it with a full private copy"
        % (how, time.monotonic() - t0, SEED_DIR))


# ---------------------------------------------------------------- measure

def measure(paths):
    for root in paths:
        files, counted, private = tree_size(root)
        say("%s: %d files; du counts %.1f MiB; private %.1f MiB (what deleting it frees)"
            % (root, files, counted / MIB, private / MIB))


# ---------------------------------------------------------------- self-test

def self_test():
    """Known-good and known-bad samples for the clone and the meter, then real
    seed runs on a throwaway repo with a stand-in for npm."""
    failures = []

    def expect(name, ok, detail=""):
        print("  %s %s%s" % ("OK  " if ok else "FAIL", name, (": " + detail) if detail and not ok else ""))
        if not ok:
            failures.append(name)

    def captured(fn, *args):
        """(stdout, exception or None) from fn(*args)."""
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                fn(*args)
        except Infra as exc:
            return buf.getvalue(), exc
        return buf.getvalue(), None

    tmp = tempfile.mkdtemp(prefix="cs-deps-selftest.")
    cwd = os.getcwd()
    locked = []  # folders made read-only by a case, restored in finally
    try:
        src = os.path.join(tmp, "src")
        os.makedirs(os.path.join(src, "pkg"))
        with open(os.path.join(src, "pkg", "blob"), "wb") as f:
            f.write(os.urandom(4 * MIB))
        os.symlink("../pkg", os.path.join(src, "link"))

        clone = os.path.join(tmp, "clone")
        clone_tree(src, clone)
        _, counted, private = tree_size(clone)
        expect("a clone reads as private 0 while du counts it", private == 0 and counted >= 4 * MIB,
               "private %d, counted %d" % (private, counted))
        expect("a clone keeps a relative symlink as a symlink",
               os.path.islink(os.path.join(clone, "link"))
               and os.readlink(os.path.join(clone, "link")) == "../pkg")

        copy = os.path.join(tmp, "copy")
        shutil.copytree(src, copy, symlinks=True)
        _, counted, private = tree_size(copy)
        expect("a plain copy reads as private (known-bad sample)", private >= 4 * MIB,
               "private %d" % private)

        _, exc = captured(clone_tree, src, clone)
        expect("cloning onto an existing folder is refused", exc is not None)

        # A throwaway repo: main checkout with node_modules, origin/main, one
        # linked worktree. The stand-in npm records each run, fails while
        # npm-fail exists, and makes a workspace node_modules. Its lockfile
        # names dep 1.0.0, the workspace link s, and an optional package
        # that npm would skip on this platform.
        repo = os.path.join(tmp, "repo")
        os.makedirs(os.path.join(repo, "node_modules", "dep"))
        os.makedirs(os.path.join(repo, "site"))
        os.makedirs(os.path.join(repo, ".githooks"))
        with open(os.path.join(repo, "node_modules", "dep", "index.js"), "wb") as f:
            f.write(os.urandom(MIB))
        os.symlink("../site", os.path.join(repo, "node_modules", "s"))

        def lock_json(packages=None, **extra):
            pk = {"": {"workspaces": ["site"]}, "site": {"name": "s"},
                  "node_modules/dep": {"version": "1.0.0"},
                  "node_modules/s": {"resolved": "site", "link": True},
                  "node_modules/other-os": {"version": "1.0.0", "optional": True, "os": ["aix"]}}
            pk.update(packages or {})
            return json.dumps(dict({"lockfileVersion": 3, "packages": pk}, **extra))

        for rel, body in (("package.json", '{"workspaces": ["site"]}'),
                          ("package-lock.json", lock_json()),
                          ("site/package.json", '{"name": "s"}'),
                          ("node_modules/dep/package.json", '{"name": "dep", "version": "1.0.0"}'),
                          (".githooks/pre-commit", "#!/bin/sh\n"),
                          (".gitignore", "node_modules/\n")):
            with open(os.path.join(repo, rel), "w") as f:
                f.write(body)
        quiet = {"capture_output": True, "check": True}

        def commit_lock(body):
            """Commit a lockfile on main, point origin/main at it, return the sha."""
            with open(os.path.join(repo, "package-lock.json"), "w") as f:
                f.write(body)
            subprocess.run(["git", "-C", repo, "add", "-A"], **quiet)
            subprocess.run(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t",
                            "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
                            "commit", "-qm", "t"], **quiet)
            subprocess.run(["git", "-C", repo, "update-ref", "refs/remotes/origin/main", "HEAD"], **quiet)
            return subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], **quiet).stdout.decode().strip()

        subprocess.run(["git", "init", "-q", repo], **quiet)
        c1 = commit_lock(lock_json())
        wt = os.path.join(tmp, "wt")
        subprocess.run(["git", "-C", repo, "worktree", "add", "-q", "--detach", wt, c1], **quiet)
        fake_npm = os.path.join(tmp, "npm")
        with open(fake_npm, "w") as f:
            f.write('#!/bin/sh\necho ran >> "%s/npm-runs"\n[ -e "%s/npm-fail" ] && exit 1\n'
                    "mkdir -p site/node_modules/dep\n" % (tmp, tmp))
        os.chmod(fake_npm, 0o755)
        os.environ["CS_DEPS_NPM"] = fake_npm
        nm = os.path.join(wt, "node_modules")
        site_nm = os.path.join(wt, "site", "node_modules")
        current = os.path.join(repo, ".git", SEED_DIR, "current")

        def runs():
            p = os.path.join(tmp, "npm-runs")
            return sum(1 for _ in open(p)) if os.path.exists(p) else 0

        def clear():
            for p in (nm, site_nm):
                if os.path.islink(p):
                    os.remove(p)
                elif os.path.isdir(p):
                    shutil.rmtree(p)

        def checkout(sha):
            subprocess.run(["git", "-C", wt, "checkout", "-q", "--detach", sha], **quiet)

        seed(wt)
        _, _, private = tree_size(nm) if os.path.isdir(nm) else (0, 0, -1)
        expect("a main worktree builds the seed once, and both node_modules are clones",
               runs() == 1 and private == 0 and os.path.isdir(site_nm),
               "npm runs %d, private %d" % (runs(), private))

        out, exc = captured(seed, wt)
        expect("a node_modules that matches its lockfile is left alone, with no INFO line",
               runs() == 1 and exc is None and out.count("\n") == 1
               and "left alone" in out and " INFO " not in out, "%r %r" % (out, exc))

        # Stale samples, the #382 defect: node_modules is present, so the
        # old code said "left alone" and never looked inside.
        wt_lock = os.path.join(wt, "package-lock.json")

        def stale(packages):
            """seed(wt) against a lockfile that wants packages: (out, exc, untouched)."""
            before = sorted(os.listdir(nm))
            with open(wt_lock, "w") as f:
                f.write(lock_json(packages))
            out, exc = captured(seed, wt)
            subprocess.run(["git", "-C", wt, "checkout", "-q", "--", "package-lock.json"], **quiet)
            return out, exc, sorted(os.listdir(nm)) == before and runs() == 1

        out, exc, untouched = stale({"node_modules/@scope/plugin": {"version": "1.0.0"}})
        expect("a node_modules missing a package the lockfile names gets one INFO line naming npm install",
               exc is None and untouched and out.count("\n") == 1 and " INFO " in out
               and "node_modules/@scope/plugin" in out and NPM_FIX in out, "%r %r" % (out, exc))

        out, exc, untouched = stale({"node_modules/dep": {"version": "2.0.0"}})
        expect("a node_modules holding another version than the lockfile gets one INFO line",
               exc is None and untouched and out.count("\n") == 1 and " INFO " in out
               and "node_modules/dep: 1.0.0 installed, 2.0.0 locked" in out, "%r %r" % (out, exc))

        out, exc, untouched = stale({"node_modules/s": {"resolved": "elsewhere", "link": True}})
        expect("a workspace link to another folder gets one INFO line",
               exc is None and untouched and " INFO " in out and "node_modules/s" in out,
               "%r %r" % (out, exc))

        with open(wt_lock, "w") as f:
            f.write('{"lockfileVersion": 1, "dependencies": {}}')
        os.chdir(wt)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = main([])
        os.chdir(cwd)
        subprocess.run(["git", "-C", wt, "checkout", "-q", "--", "package-lock.json"], **quiet)
        out = buf.getvalue()
        expect("a lockfile with no packages map is one INFRA line with exit 3, never a pass",
               rc == 3 and out.count("\n") == 1 and " INFRA " in out and NPM_FIX in out
               and "npm ci" not in out, "rc %r, out %r" % (rc, out))

        clear()
        seed(wt)
        expect("matching manifests reuse the seed without npm", runs() == 1 and os.path.isdir(nm))

        clear()
        with open(os.path.join(wt, "package-lock.json"), "w") as f:
            f.write(lock_json(branch=True))
        out, exc = captured(seed, wt)
        expect("a lockfile that differs from origin/main's gets no install and one INFO line",
               runs() == 1 and not os.path.lexists(nm) and exc is None
               and out.count("\n") == 1 and " INFO " in out, "%r %r" % (out, exc))
        subprocess.run(["git", "-C", wt, "checkout", "-q", "--", "package-lock.json"], **quiet)

        c2 = commit_lock(lock_json(v=2))
        checkout(c2)
        seed(wt)
        expect("a new origin/main lockfile rebuilds the seed", runs() == 2 and os.path.isdir(nm))

        clear()
        c3 = commit_lock(lock_json(v=3))
        checkout(c3)
        open(os.path.join(tmp, "npm-fail"), "w").close()
        _, exc = captured(seed, wt)
        with open(os.path.join(current, "package-lock.json")) as f:
            kept = '"v": 2' in f.read()
        leftovers = [n for n in os.listdir(os.path.dirname(current)) if n.startswith(("build-", "old-"))]
        expect("an npm failure keeps the old seed and leaves nothing half built",
               runs() == 3 and exc is not None and kept and not leftovers and not os.path.lexists(nm),
               "exc %r, kept %r, leftovers %r" % (exc, kept, leftovers))
        os.remove(os.path.join(tmp, "npm-fail"))

        seed_root = os.path.dirname(current)
        os.chmod(seed_root, 0o555)
        locked.append(seed_root)
        os.chdir(wt)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = main([])
        os.chdir(cwd)
        os.chmod(seed_root, 0o755)
        locked.remove(seed_root)
        out = buf.getvalue()
        expect("an unexpected error is one INFRA line with exit 3",
               rc == 3 and out.count("\n") == 1 and " INFRA " in out and "Traceback" not in out,
               "rc %r, out %r" % (rc, out))

        checkout(c2)
        site_dir = os.path.join(wt, "site")
        os.chmod(site_dir, 0o555)
        locked.append(site_dir)
        _, exc = captured(seed, wt)
        os.chmod(site_dir, 0o755)
        locked.remove(site_dir)
        expect("a failed workspace clone removes the root clone it made",
               exc is not None and not os.path.lexists(nm), "exc %r" % exc)

        os.symlink(os.path.join(tmp, "missing"), nm)
        out, _ = captured(seed, wt)
        expect("a dangling node_modules symlink is left alone, with an INFO line",
               os.path.islink(nm) and not os.path.exists(nm) and "left alone" in out
               and " INFO " in out, "%r" % out)
        os.remove(nm)

        # Hold the seed lock, start a run, and make node_modules while it waits.
        held = os.open(os.path.join(seed_root, "lock"), os.O_RDWR)
        fcntl.flock(held, fcntl.LOCK_EX)
        result = {}
        waiter = threading.Thread(target=lambda: result.update(zip(("out", "exc"), captured(seed, wt))))
        waiter.start()
        time.sleep(0.5)
        os.mkdir(nm)
        os.close(held)
        waiter.join(LOCK_WAIT_S)
        expect("a node_modules made while waiting for the lock is left alone",
               result.get("exc") is None and "left alone" in result.get("out", ""),
               "%r" % result)
        os.rmdir(nm)

        esc = os.path.join(tmp, "esc")
        os.makedirs(esc)
        os.makedirs(os.path.join(tmp, "outside"))
        for rel, body in (("esc/package.json", '{"workspaces": ["../outside"]}'),
                          ("esc/package-lock.json", "{}"), ("outside/package.json", "{}")):
            with open(os.path.join(tmp, rel), "w") as f:
                f.write(body)
        _, exc = captured(manifests, esc)
        expect("a workspace path outside the repository is refused", exc is not None)

        before = os.listdir(os.path.join(repo, "node_modules"))
        out, exc = captured(seed, repo)
        expect("the main checkout is never seeded or changed",
               os.listdir(os.path.join(repo, "node_modules")) == before and runs() == 3
               and exc is None and " INFO " not in out, "%r %r" % (out, exc))

        with open(os.path.join(repo, "package-lock.json"), "w") as f:
            f.write(lock_json({"node_modules/dep": {"version": "2.0.0"}}))
        out, exc = captured(seed, repo)
        expect("a main checkout whose node_modules differs gets one INFO line and no change",
               os.listdir(os.path.join(repo, "node_modules")) == before and runs() == 3
               and exc is None and out.count("\n") == 1 and " INFO " in out, "%r %r" % (out, exc))

        # --session-dir, as the hook runs it: a child process with the hook
        # input on stdin.
        me = [sys.executable, "-I", os.path.abspath(__file__), "--session-dir"]
        other = os.path.join(tmp, "other-repo")
        subprocess.run(["git", "init", "-q", other], **quiet)

        def session_dir_out(data, project=None):
            env = dict(os.environ)
            env.pop("CLAUDE_PROJECT_DIR", None)
            if project:
                env["CLAUDE_PROJECT_DIR"] = project
            r = subprocess.run(me, input=data, capture_output=True, cwd=tmp, env=env, timeout=30)
            return r.returncode, r.stdout.decode()

        def hook_input(cwd_field):
            return json.dumps({"session_id": "t", "hook_event_name": "SessionStart",
                               "source": "startup", "cwd": cwd_field}).encode()

        real_wt, real_repo = os.path.realpath(wt), os.path.realpath(repo)
        rc, out = session_dir_out(hook_input(os.path.join(wt, "site")), project=repo)
        expect("--session-dir prints the top of the worktree the input's cwd names, over CLAUDE_PROJECT_DIR",
               rc == 0 and os.path.realpath(out.strip() or tmp) == real_wt, "rc %r, out %r" % (rc, out))
        rc, out = session_dir_out(hook_input(other), project=repo)
        expect("--session-dir passes over a checkout without .githooks/ to CLAUDE_PROJECT_DIR",
               rc == 0 and os.path.realpath(out.strip() or tmp) == real_repo, "rc %r, out %r" % (rc, out))
        rc, out = session_dir_out(b"refs/heads/x 0000\n", project=wt)
        expect("--session-dir falls back to CLAUDE_PROJECT_DIR when stdin is not JSON",
               rc == 0 and os.path.realpath(out.strip() or tmp) == real_wt, "rc %r, out %r" % (rc, out))
        env = dict(os.environ)
        env.pop("CLAUDE_PROJECT_DIR", None)
        t0 = time.monotonic()
        p = subprocess.Popen(me, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, cwd=tmp, env=env)
        try:
            rc = p.wait(timeout=30)
        finally:
            p.stdin.close()
        out = p.stdout.read().decode()
        p.stdout.close()
        waited = time.monotonic() - t0
        expect("--session-dir on an idle pipe stops waiting and prints nothing outside a checkout",
               rc == 0 and out == "" and waited < SESSION_INPUT_WAIT_S + 5,
               "rc %r, out %r, waited %.1f s" % (rc, out, waited))
    finally:
        os.chdir(cwd)
        for path in locked:
            os.chmod(path, 0o755)
        os.environ.pop("CS_DEPS_NPM", None)
        shutil.rmtree(tmp, ignore_errors=True)
    print("%s self-test %s" % (PREFIX, "FAILED: " + ", ".join(failures) if failures else "passed"))
    return 1 if failures else 0


# ---------------------------------------------------------------- entry point

def run(argv):
    if argv == ["--session-dir"]:
        return session_dir()
    if argv == ["--self-test"]:
        return self_test()
    if argv[:1] == ["--measure"]:
        top = git(os.getcwd(), "rev-parse", "--show-toplevel")
        measure(argv[1:] or [p for p in (top, os.path.join(top, "node_modules")) if os.path.isdir(p)])
        return 0
    if not argv:
        seed(os.getcwd())
        return 0
    print(__doc__.split("\n\n")[0], file=sys.stderr)
    print("usage: worktree_deps.py [--measure [PATH...] | --self-test | --session-dir]", file=sys.stderr)
    return 2


def main(argv):
    what = "check" if argv else "seed"
    advice = "" if argv else (" Run python3 -I scripts/worktree_deps.py again, "
                              "or npm ci for a full private install.")
    try:
        return run(argv)
    except Infra as exc:
        say("INFRA could not %s: %s.%s" % (exc.what or what, exc,
                                            advice if exc.advice is None else exc.advice))
    except Exception as exc:  # one line, never a traceback in the model's context
        say("INFRA could not %s: unexpected %s: %s.%s" % (what, type(exc).__name__, exc, advice))
    return 3


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
