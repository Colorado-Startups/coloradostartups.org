#!/usr/bin/env bash
# coloradostartups-site: session start. Turns the git hooks on, then seeds a
# new worktree's node_modules or checks an existing one.
#
# Wired in .claude/settings.json under SessionStart. FIRES at session start.
# (The settings file is the authority on that wiring, not this comment;
# 04_tools/contract_test.py C8 checks they agree.)
#
# Without core.hooksPath=.githooks, .githooks/pre-commit and pre-push never
# run, and no check blocks a change. The org ruleset on main requires a pull
# request and no status check, so the git hooks are the blocking gate (gh api
# rulesets, 2026-11-02). So this sets the repo-local value to .githooks when
# no repo config sets it. A value from global or system config does not
# count, because it is one person's setting for every repo, not this repo's
# choice. Idempotent. Never overrides a local or worktree value; it says so
# instead.
#
# It reads the effective value (git config --get), the one git uses when it
# runs a hook. A worktree setting (git config --worktree) overrides the
# shared one. Reading with --local would miss it. An absolute path that ends
# in /.githooks counts as firing when its pre-commit and pre-push match this
# checkout's .githooks byte for byte and are executable. Otherwise it warns
# and names each file. cs-site-route.sh is not compared: both hooks source it
# from this checkout ($REPO_ROOT), so this checkout's copy always runs.
#
# Then it routes to scripts/worktree_deps.py, which decides whether this
# worktree gets an APFS clone of the shared node_modules seed (decision 74).
# That script never touches an existing node_modules or the main checkout.
# It checks an existing one against package-lock.json instead, and names
# npm install when they differ.
# Prints only what a session should act on: a warning, an error, a fix to
# run, or a change it made. A step that finds nothing to do prints nothing,
# because every later model call in the session reads these lines again
# (blockers.hook_tokens_per_session; the two all-clear lines cost about 47K
# tokens a session, Quality page run 41775739632). Always exits 0.
#
# Both steps run in the checkout the session works in. settings.json starts
# this file from CLAUDE_PROJECT_DIR, which stays at the project root where
# the session started; in an app-created worktree that was the main checkout
# (issue #382). The cwd field of the hook's JSON input on stdin names the
# session's worktree (hooks docs, read 2026-11-02). This file's own
# scripts/worktree_deps.py --session-dir reads that input and prints the
# folder to use. Without it, or when it prints nothing, the fallbacks are
# CLAUDE_PROJECT_DIR, then the current directory.

set -uo pipefail

HOOK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)"
SESSION_DIR=""
if [ -n "$HOOK_ROOT" ] && [ -f "$HOOK_ROOT/scripts/worktree_deps.py" ] && command -v python3 >/dev/null 2>&1; then
  SESSION_DIR="$(python3 -I "$HOOK_ROOT/scripts/worktree_deps.py" --session-dir 2>/dev/null)"
fi
moved=""
for dir in "$SESSION_DIR" "${CLAUDE_PROJECT_DIR:-}" "$(pwd)"; do
  if [ -n "$dir" ] && cd "$dir" 2>/dev/null; then
    moved=1
    break
  fi
done
[ -n "$moved" ] || exit 0

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "cs-site: not a git checkout; git hooks not configured"
  exit 0
fi
if [ ! -d .githooks ]; then
  echo "cs-site: .githooks/ is missing; git hooks not configured"
  exit 0
fi

# These are the hooks git runs from core.hooksPath. Another .githooks path
# counts only when both match this checkout's copy and are executable.
HOOK_FILES="pre-commit pre-push"

# differing_hooks DIR: print each hook file in DIR that is missing, differs
# from this checkout's .githooks copy byte for byte, or is not executable.
# Prints nothing when all pass.
differing_hooks() {
  local dir="$1" f out=""
  for f in $HOOK_FILES; do
    if [ ! -f "$dir/$f" ] || [ ! -f ".githooks/$f" ] || ! cmp -s "$dir/$f" ".githooks/$f"; then
      out="${out:+$out, }$f"
    elif [ ! -x "$dir/$f" ]; then
      out="${out:+$out, }$f (not executable, so git skips it)"
    fi
  done
  printf '%s' "$out"
}

# unrunnable_hooks: print each hook file in this checkout's .githooks that
# git would skip, missing or not executable. Prints nothing when all run.
unrunnable_hooks() {
  local f out=""
  for f in $HOOK_FILES; do
    if [ ! -f ".githooks/$f" ]; then
      out="${out:+$out, }$f (missing)"
    elif [ ! -x ".githooks/$f" ]; then
      out="${out:+$out, }$f (not executable)"
    fi
  done
  printf '%s' "$out"
}

current="$(git config --get core.hooksPath 2>/dev/null || true)"
# Which config the effective value comes from: local, worktree, global,
# system or command. Empty when unset. Also empty when git predates
# --show-scope (2.26); a set value then counts as a repo value and is never
# overridden.
scope="$(git config --show-scope --get core.hooksPath 2>/dev/null | cut -f1)"
if [ -z "$current" ] || [ "$scope" = "global" ] || [ "$scope" = "system" ]; then
  from=""
  [ -n "$current" ] && from=" in the repo config, over the $scope value '$current'"
  if git config --local core.hooksPath .githooks 2>/dev/null; then
    echo "cs-site: set core.hooksPath=.githooks$from; pre-commit and pre-push now fire"
  else
    echo "cs-site: could not set core.hooksPath; run: git config core.hooksPath .githooks"
  fi
elif [ "$current" = ".githooks" ]; then
  : # The hooks fire; nothing to say.
else
  case "$current" in
    /*/.githooks|/*/.githooks/)
      differ="$(differing_hooks "${current%/}")"
      if [ -n "$differ" ]; then
        echo "cs-site: WARN core.hooksPath is '$current'; git runs the hooks at that path, and these hook files there are not runnable copies of this checkout's .githooks: $differ. Left unchanged. To see which config sets it: git config --show-origin --get core.hooksPath"
      fi
      ;;
    *)
      echo "cs-site: core.hooksPath is '$current', not .githooks; left unchanged. The repo gates will not fire until: git config core.hooksPath .githooks"
      ;;
  esac
fi

# With core.hooksPath at .githooks, git runs this checkout's own files, and
# skips one that is not executable without a word: the gates are off and
# nobody hears. So say it, naming the fix.
if [ "$(git config --get core.hooksPath 2>/dev/null || true)" = ".githooks" ]; then
  bad="$(unrunnable_hooks)"
  [ -n "$bad" ] && echo "cs-site: WARN core.hooksPath is .githooks, but git skips these files there: $bad. Fix: chmod +x .githooks/pre-commit .githooks/pre-push"
fi

if [ -f scripts/worktree_deps.py ] && command -v python3 >/dev/null 2>&1; then
  # The lockfile-drift line names up to three packages per list and the
  # reason not to run npm ci; the session needs only the counts and the fix.
  # Only the two lines that checked node_modules against the lockfile and
  # found it matching go. "node_modules present; left alone" (unchecked) and
  # "main checkout; nothing to seed" (a hint to install) still print.
  python3 -I scripts/worktree_deps.py \
    | sed -E '/^cs-site deps: (main checkout; node_modules matches|node_modules present and matches)/d; s/ \([^)]*\)//g; s/\. It was left alone\. Run (.*), not npm ci, which .*$/; left alone. Fix: \1, never npm ci./'
  rc=${PIPESTATUS[0]}
  # Exit 0 and 3 have printed their own line. Anything else is a crash the
  # script could not report, so say it here.
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 3 ]; then
    echo "cs-site deps: INFRA scripts/worktree_deps.py exited $rc; run npm ci"
  fi
fi
exit 0
