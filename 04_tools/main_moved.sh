#!/usr/bin/env bash
# main_moved.sh: has a newer push to main replaced the commit this run builds?
#
# quality-pages.yml asks between its steps on a push to main. Its concurrency
# group keeps one waiting run and drops older ones, so when main has moved, a
# newer run is already queued and will build and deploy the page from newer
# data. This run can stop doing work instead of building a page nobody sees:
# 9 of 23 push builds on 2026-11-03 02:38 to 16:18 UTC had a newer push before
# they finished (gh api jobs of every run, #568).
#
# Usage:  bash 04_tools/main_moved.sh SHA [REMOTE]   REMOTE defaults to origin
#         bash 04_tools/main_moved.sh --self-test
# Output: moved=true or moved=false on stdout, and appended to $GITHUB_OUTPUT
#         when that is set, with one line saying why.
# Fails toward building: an empty SHA, or a remote it cannot read, is
#         moved=false. Only a readable main that differs from SHA is moved=true.
# Exit:   0 decided, 2 usage error.
set -uo pipefail

decide() {
  local sha="${1:-}" remote="${2:-origin}" head moved reason
  if [ -z "$sha" ]; then
    moved=false reason="No commit given; building."
  elif ! head="$(git ls-remote --exit-code "$remote" refs/heads/main 2>/dev/null | cut -f1)" || [ -z "$head" ]; then
    moved=false reason="Could not read main on $remote; building."
  elif [ "$head" = "$sha" ]; then
    moved=false reason="main is still ${sha:0:12}; building."
  else
    moved=true reason="main moved from ${sha:0:12} to ${head:0:12}; the run for the newer push builds the page."
  fi
  echo "$reason"
  echo "moved=$moved"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "moved=$moved" >> "$GITHUB_OUTPUT"; fi
  return 0
}

# A throwaway origin and clone: the same main stays, a newer push moves, an
# empty SHA and an unreadable remote both build, and GITHUB_OUTPUT gets the line.
self_test() {
  local wrong=0 dir out first
  dir="$(mktemp -d "${TMPDIR:-/tmp}/main-moved-selftest.XXXXXX")" || { echo "  FAIL could not make a temp dir"; return 1; }
  out="$dir/out"
  (
    cd "$dir" || exit 1
    git init -q --bare origin.git
    git init -q -b main work && cd work || exit 1
    git config user.email selftest@example.invalid && git config user.name selftest
    echo a > a.txt && git add a.txt && git commit -qm one
    git remote add origin "$dir/origin.git" && git push -q origin main
  ) || { echo "  FAIL could not seed the throwaway repos"; rm -rf "$dir"; return 1; }
  first="$(git -C "$dir/work" rev-parse HEAD)"
  check() { # NAME WANT-LINE ARGS...
    local name="$1" want="$2"; shift 2
    : > "$out"
    if [ "$(cd "$dir/work" && GITHUB_OUTPUT="$out" decide "$@" | tail -1)" = "$want" ] && [ "$(cat "$out")" = "$want" ]; then
      echo "  OK   $name: $want"
    else
      echo "  FAIL $name: expected $want"; wrong=$((wrong + 1))
    fi
  }
  check "main still at this commit" "moved=false" "$first"
  check "an empty commit builds" "moved=false" ""
  check "an unreadable remote builds" "moved=false" "$first" "$dir/missing.git"
  (cd "$dir/work" && echo b > a.txt && git commit -qam two && git push -q origin main)
  check "a newer push to main" "moved=true" "$first"
  rm -rf "$dir"
  if [ "$wrong" -eq 0 ]; then echo "main_moved.sh self-test: PASS"; return 0; fi
  echo "main_moved.sh self-test: FAIL ($wrong)"
  return 1
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit $?
fi
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: bash 04_tools/main_moved.sh SHA [REMOTE] | --self-test" >&2
  exit 2
fi
decide "$@"
exit $?
