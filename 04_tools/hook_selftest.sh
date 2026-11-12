#!/usr/bin/env bash
# hook_selftest.sh: prove the git hooks block what they should, in a throwaway repo.
#
# House rule: every gate ships a self-test that seeds a known-bad and a
# known-clean sample and fails if either behaves wrong. cs_site_lint.py
# --self-test covers the rules; this covers the wiring around them, which a
# rule test cannot see (a non-executable hook, a wrong hooksPath, a router
# that swallows exit 1).
#
# Setup, in a fresh repo under mktemp -d (the real checkout is never touched):
# copy 04_tools, .githooks, .claude/settings.json, .claude/hooks,
# .secretlintrc.json, CLAUDE.md, .claude/rules and .github; set core.hooksPath.
# .claude/rules/site-gates.md is required: the contract test's C5 fails
# without it, so step 1 would too.
#
# Steps, numbered as the section markers below:
#   1. Commit those plus a known-clean data/dispatches/clean.md. Must succeed.
#   2. Stage a known-bad data/dispatches/bad.md (an em dash and the word
#      Ironforge). The commit must be refused, for those two reasons.
#   3. Pipe a ref line for refs/heads/main into pre-push. Must be refused.
#   4. Pipe a ref line for a feature branch at HEAD into pre-push. Must pass.
#   5. pre-push runs no tests (Paul, 2026-11-02: no testing on the Mac). Give
#      the repo node_modules, a package.json naming check:push, and a stub
#      npm on PATH that logs its calls. A ref line whose commit is not HEAD
#      must be refused, naming the fix. A ref line at HEAD, and a commit
#      touching site/, must pass. None of the three may call npm.
#   6. Run 04_tools/ci_gate.sh on children that exit 0, 1, 2 and 3. Exit 3
#      must become 0 with one ::warning:: line naming the command. Every
#      other code must pass through. A newline in an argument must not start
#      a second workflow command.
#   7. Run .claude/hooks/cs-site-session-start.sh in fresh repos, one per
#      core.hooksPath value: unset, a global-only value, .githooks, a
#      matching absolute .githooks path, the same with pre-commit not
#      executable, a mismatched one, an unrelated value, and a worktree value
#      over a shared one, and .githooks with pre-commit not executable.
#      Each must print the right line (nothing when the hooks already fire),
#      exit 0 and leave the expected effective value (a repo value is never
#      changed). Then a stub worktree_deps.py: the filter drops only the two
#      lines that found node_modules matching, and passes every other line.
#
# Usage:  bash 04_tools/hook_selftest.sh
# Exit:   0 all steps behaved, 1 a step misbehaved, 3 could not run (no git
#         or python3).

set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_PREFIX

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZERO="0000000000000000000000000000000000000000"

for tool in git python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "INFRA: $tool not found; hook self-test could not run" >&2
    exit 3
  fi
done

TMPBASE="${TMPDIR:-/tmp}"
TMP="$(mktemp -d "${TMPBASE%/}/cs-site-hooktest.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
REPO="$TMP/repo"
mkdir -p "$REPO/.claude" "$REPO/data/dispatches"

cp -R "$SRC/04_tools" "$REPO/04_tools"
cp -R "$SRC/.githooks" "$REPO/.githooks"
[ -f "$SRC/.claude/settings.json" ] && cp "$SRC/.claude/settings.json" "$REPO/.claude/settings.json"
[ -d "$SRC/.claude/hooks" ] && cp -R "$SRC/.claude/hooks" "$REPO/.claude/hooks"
[ -f "$SRC/.secretlintrc.json" ] && cp "$SRC/.secretlintrc.json" "$REPO/.secretlintrc.json"
cp "$SRC/CLAUDE.md" "$REPO/CLAUDE.md"
[ -d "$SRC/.claude/rules" ] && cp -R "$SRC/.claude/rules" "$REPO/.claude/rules"
[ -d "$SRC/.github" ] && cp -R "$SRC/.github" "$REPO/.github"
rm -rf "$REPO/04_tools/__pycache__"

g() { git -C "$REPO" -c commit.gpgsign=false -c user.name="hook selftest" \
        -c user.email="hook-selftest@example.invalid" "$@"; }

g init -q
g checkout -q -b selftest-branch
g config core.hooksPath .githooks

failures=0
pass() { echo "hook-selftest: $1: OK"; }
fail() { echo "hook-selftest: $1: FAIL"; failures=$((failures + 1)); }

# --- 1. clean commit must succeed -------------------------------------------
printf '# Clean dispatch\n\nFounders met in Denver on Tuesday.\n\nThe next meetup is in Boulder.\n' \
  > "$REPO/data/dispatches/clean.md"
g add -A
if out="$(g commit -q -m "clean" 2>&1)"; then
  pass "a clean commit is accepted"
else
  fail "a clean commit is accepted"
  printf '%s\n' "$out" | tail -20
fi
head_clean="$(g rev-parse --verify --quiet HEAD || true)"

# --- 2. bad commit must be refused, for the right reasons -------------------
printf '# Bad dispatch\n\nWelcome to Ironforge \xe2\x80\x94 the hall of founders.\n' \
  > "$REPO/data/dispatches/bad.md"
g add data/dispatches/bad.md
if out="$(g commit -q -m "bad" 2>&1)"; then
  fail "a commit with an em dash and Ironforge is refused (it was accepted)"
else
  if grep -q 'em-dash' <<<"$out" && grep -q 'franchise-name' <<<"$out"; then
    pass "a commit with an em dash and Ironforge is refused, naming both"
  else
    fail "a commit with an em dash and Ironforge is refused, naming both"
    printf '%s\n' "$out" | tail -20
  fi
fi
if [ "$(g rev-parse --verify --quiet HEAD || true)" = "$head_clean" ] && [ -n "$head_clean" ]; then
  pass "HEAD did not move"
else
  fail "HEAD did not move"
fi
g rm -q --cached data/dispatches/bad.md >/dev/null 2>&1 || true
rm -f "$REPO/data/dispatches/bad.md"

# --- 3. pre-push must refuse main --------------------------------------------
if out="$(cd "$REPO" && printf 'refs/heads/selftest-branch %s refs/heads/main %s\n' \
            "$head_clean" "$ZERO" | .githooks/pre-push origin https://example.invalid/repo.git 2>&1)"; then
  fail "pre-push refuses refs/heads/main (it allowed the push)"
else
  if grep -q 'refs/heads/main' <<<"$out"; then
    pass "pre-push refuses refs/heads/main"
  else
    fail "pre-push refuses refs/heads/main, saying why"
    printf '%s\n' "$out" | tail -10
  fi
fi

# --- 4. pre-push must pass a clean feature branch ----------------------------
# $head_clean is HEAD: step 2 checked that HEAD did not move.
if out="$(cd "$REPO" && printf 'refs/heads/selftest-branch %s refs/heads/selftest-branch %s\n' \
            "$head_clean" "$ZERO" | .githooks/pre-push origin https://example.invalid/repo.git 2>&1)"; then
  pass "pre-push accepts a clean feature branch"
else
  fail "pre-push accepts a clean feature branch"
  printf '%s\n' "$out" | tail -20
fi

# --- 5. pre-push runs no tests, and pushes only HEAD --------------------------
# Paul, 2026-11-02: the Mac runs no tests; CI's site-tests job runs check:push.
# So pre-push must never call npm, even with node_modules and a check:push
# script in place. The stub npm logs any call. A pushed commit other than HEAD
# is still refused (issue #302).
STUB="$TMP/stub-bin"
NPM_CALLS="$TMP/npm-calls"
mkdir -p "$STUB" "$REPO/node_modules"
cat > "$STUB/npm" <<STUB_EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$NPM_CALLS"
exit 0
STUB_EOF
chmod +x "$STUB/npm"
printf '{ "scripts": { "check:push": "true" } }\n' > "$REPO/package.json"
# The same tree as HEAD in a new commit, so "not HEAD" is all that is wrong.
other="$(g commit-tree -p "$head_clean" -m "not head" "$head_clean^{tree}" 2>/dev/null || true)"

rm -f "$NPM_CALLS"
rc=0
out="$(cd "$REPO" && printf 'refs/heads/selftest-other %s refs/heads/selftest-other %s\n' "$other" "$ZERO" \
        | PATH="$STUB:$PATH" .githooks/pre-push origin https://example.invalid/repo.git 2>&1)" || rc=$?
if [ -z "$other" ]; then
  fail "pre-push refuses a commit that is not HEAD (could not make the commit)"
elif [ "$rc" -eq 0 ]; then
  fail "pre-push refuses a commit that is not HEAD (it allowed the push)"
elif ! grep -qF 'check out the branch, or push it from its own worktree' <<<"$out"; then
  fail "pre-push refuses a commit that is not HEAD, naming the fix"
  printf '%s\n' "$out" | tail -10
elif [ -s "$NPM_CALLS" ]; then
  fail "pre-push refuses a commit that is not HEAD without calling npm (it called: $(head -1 "$NPM_CALLS"))"
else
  pass "pre-push refuses a commit that is not HEAD, naming the fix"
fi

rm -f "$NPM_CALLS"
rc=0
out="$(cd "$REPO" && printf 'refs/heads/selftest-branch %s refs/heads/selftest-branch %s\n' "$head_clean" "$ZERO" \
        | PATH="$STUB:$PATH" .githooks/pre-push origin https://example.invalid/repo.git 2>&1)" || rc=$?
if [ "$rc" -ne 0 ]; then
  fail "pre-push accepts HEAD with node_modules in place (exit $rc)"
  printf '%s\n' "$out" | tail -20
elif [ -s "$NPM_CALLS" ]; then
  fail "pre-push accepts HEAD and runs no tests (it called npm: $(head -1 "$NPM_CALLS"))"
else
  pass "pre-push accepts HEAD and runs no tests"
fi

# A commit touching site/, pushed over a known remote sha: the change CI's
# site-tests job runs check:push for. pre-push still runs no tests.
mkdir -p "$REPO/site"
printf 'a\n' > "$REPO/site/a.txt"
g add site/a.txt
g commit -q -m "site change" >/dev/null 2>&1 || true
site_change="$(g rev-parse --verify --quiet HEAD || true)"
rm -f "$NPM_CALLS"
rc=0
out="$(cd "$REPO" && printf 'refs/heads/selftest-branch %s refs/heads/selftest-branch %s\n' "$site_change" "$head_clean" \
        | PATH="$STUB:$PATH" .githooks/pre-push origin https://example.invalid/repo.git 2>&1)" || rc=$?
if [ -z "$site_change" ] || [ "$site_change" = "$head_clean" ]; then
  fail "pre-push runs no tests for a push touching site/ (could not make the commit)"
elif [ "$rc" -ne 0 ]; then
  fail "pre-push accepts a push touching site/ (exit $rc)"
  printf '%s\n' "$out" | tail -10
elif [ -s "$NPM_CALLS" ]; then
  fail "pre-push runs no tests for a push touching site/ (it called npm: $(head -1 "$NPM_CALLS"))"
else
  pass "pre-push runs no tests for a push touching site/"
fi
rm -rf "$REPO/node_modules" "$REPO/package.json"

# --- 6. ci_gate.sh applies the exit contract in CI ----------------------------
GATE="$REPO/04_tools/ci_gate.sh"
for code in 0 1 2 3; do
  want="$code"
  [ "$code" -eq 3 ] && want=0
  rc=0
  out="$(bash "$GATE" bash -c "exit $code" 2>&1)" || rc=$?
  label="ci_gate.sh turns exit $code into $want"
  if [ "$rc" -ne "$want" ]; then
    fail "$label (got $rc)"
  elif [ "$code" -eq 3 ] && ! grep -q '^::warning title=[^:]*::bash -c exit 3 could not check' <<<"$out"; then
    fail "$label, with a ::warning:: line naming the command"
    printf '%s\n' "$out" | tail -5
  elif [ "$code" -ne 3 ] && grep -q '::warning' <<<"$out"; then
    fail "$label, with no ::warning:: line"
  else
    pass "$label"
  fi
done
rc=0
bash "$GATE" >/dev/null 2>&1 || rc=$?
if [ "$rc" -eq 2 ]; then pass "ci_gate.sh exits 2 when given no command"; else fail "ci_gate.sh exits 2 when given no command (got $rc)"; fi
rc=0
out="$(bash "$GATE" bash -c 'exit 3' x "$(printf 'a\n::error::injected')" 2>&1)" || rc=$?
if [ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | grep -c '^::')" -eq 1 ] \
   && grep -q 'a%0A::error::injected' <<<"$out"; then
  pass "ci_gate.sh escapes a newline, so an argument cannot start a second workflow command"
else
  fail "ci_gate.sh escapes a newline, so an argument cannot start a second workflow command"
  printf '%s\n' "$out" | tail -5
fi

# --- 7. session start reads the effective core.hooksPath ---------------------
# Each case gets a fresh repo. The user's global and system git config are
# kept out: SESSION_GLOBAL is the only global config the hook sees.
SESSION_GLOBAL=/dev/null
sgit() { GIT_CONFIG_GLOBAL="$SESSION_GLOBAL" GIT_CONFIG_NOSYSTEM=1 git "$@"; }
session_repo() {
  local dir="$TMP/session-$1"
  mkdir -p "$dir/.claude"
  git -C "$dir" init -q
  cp -R "$SRC/.githooks" "$dir/.githooks"
  cp -R "$SRC/.claude/hooks" "$dir/.claude/hooks"
  printf '%s' "$dir"
}
# session_case LABEL DIR WANT_LINE WANT_VALUE: run the hook in DIR. It must
# exit 0, print a line holding WANT_LINE (print nothing when WANT_LINE is
# empty: every later model call reads the hook's output again), and leave
# WANT_VALUE as the effective core.hooksPath.
session_case() {
  local label="$1" dir="$2" want="$3" want_value="$4" after out rc=0
  out="$(cd "$dir" && GIT_CONFIG_GLOBAL="$SESSION_GLOBAL" GIT_CONFIG_NOSYSTEM=1 CLAUDE_PROJECT_DIR="$dir" \
           bash .claude/hooks/cs-site-session-start.sh 2>&1)" || rc=$?
  after="$(sgit -C "$dir" config --get core.hooksPath || true)"
  if [ "$rc" -ne 0 ]; then
    fail "session start, $label: exits 0 (got $rc)"
  elif [ -z "$want" ] && [ -n "$out" ]; then
    fail "session start, $label: prints nothing"
    printf '%s\n' "$out" | tail -5
  elif [ -n "$want" ] && ! grep -qF -- "$want" <<<"$out"; then
    fail "session start, $label: prints '$want'"
    printf '%s\n' "$out" | tail -5
  elif [ "$after" != "$want_value" ]; then
    fail "session start, $label: core.hooksPath ends as '$want_value' (got '$after')"
  else
    pass "session start, $label"
  fi
}

d="$(session_repo unset)"
session_case "unset value is set to .githooks" "$d" \
  "cs-site: set core.hooksPath=.githooks; pre-commit and pre-push now fire" ".githooks"

# A global value is one person's setting for every repo, so the repo-local
# .githooks goes on top of it.
SESSION_GLOBAL="$TMP/global.gitconfig"
printf '[core]\n\thooksPath = %s\n' "$TMP/global-hooks" > "$SESSION_GLOBAL"
d="$(session_repo global)"
session_case "a global-only value gets the repo-local .githooks" "$d" \
  "set core.hooksPath=.githooks in the repo config, over the global value '$TMP/global-hooks'" ".githooks"
if [ "$(sgit -C "$d" config --local --get core.hooksPath || true)" = ".githooks" ] \
   && [ "$(sgit -C "$d" config --global --get core.hooksPath || true)" = "$TMP/global-hooks" ]; then
  pass "session start, the global-only case writes the local config and leaves the global one"
else
  fail "session start, the global-only case writes the local config and leaves the global one"
fi
SESSION_GLOBAL=/dev/null

d="$(session_repo relative)"
sgit -C "$d" config core.hooksPath .githooks
session_case ".githooks fires, silently" "$d" "" ".githooks"

mkdir -p "$TMP/main-checkout"
cp -R "$SRC/.githooks" "$TMP/main-checkout/.githooks"
d="$(session_repo match)"
sgit -C "$d" config core.hooksPath "$TMP/main-checkout/.githooks"
session_case "a matching absolute .githooks path fires from that path, silently" "$d" "" \
  "$TMP/main-checkout/.githooks"

# Byte-equal but not executable: git skips the hook, so it must not count.
mkdir -p "$TMP/noexec-checkout"
cp -R "$SRC/.githooks" "$TMP/noexec-checkout/.githooks"
chmod -x "$TMP/noexec-checkout/.githooks/pre-commit"
d="$(session_repo noexec)"
sgit -C "$d" config core.hooksPath "$TMP/noexec-checkout/.githooks"
session_case "a matching path with pre-commit not executable warns, naming the file" "$d" \
  "are not runnable copies of this checkout's .githooks: pre-commit (not executable, so git skips it)." \
  "$TMP/noexec-checkout/.githooks"

mkdir -p "$TMP/stale-checkout"
cp -R "$SRC/.githooks" "$TMP/stale-checkout/.githooks"
printf '# stale copy\n' >> "$TMP/stale-checkout/.githooks/pre-push"
d="$(session_repo mismatch)"
sgit -C "$d" config core.hooksPath "$TMP/stale-checkout/.githooks"
session_case "a mismatched absolute .githooks path warns, naming the file" "$d" \
  "WARN core.hooksPath is '$TMP/stale-checkout/.githooks'; git runs the hooks at that path, and these hook files there are not runnable copies of this checkout's .githooks: pre-push." \
  "$TMP/stale-checkout/.githooks"

d="$(session_repo unrelated)"
sgit -C "$d" config core.hooksPath "$TMP/hooks-elsewhere"
session_case "an unrelated value keeps the old warning" "$d" \
  "not .githooks; left unchanged. The repo gates will not fire until: git config core.hooksPath .githooks" \
  "$TMP/hooks-elsewhere"

# The defect this fixes: the shared config holds another path and the
# worktree config holds .githooks. git uses the worktree value.
d="$(session_repo worktree)"
sgit -C "$d" config extensions.worktreeConfig true
sgit -C "$d" config --local core.hooksPath "$TMP/hooks-elsewhere"
sgit -C "$d" config --worktree core.hooksPath .githooks
session_case "a worktree .githooks over a shared value fires, silently" "$d" "" ".githooks"

# .githooks itself with a hook that is not executable: git skips it
# silently, so the session must hear it, with the fix.
d="$(session_repo noexec-local)"
sgit -C "$d" config core.hooksPath .githooks
chmod -x "$d/.githooks/pre-commit"
session_case ".githooks with pre-commit not executable warns, naming the fix" "$d" \
  "git skips these files there: pre-commit (not executable). Fix: chmod +x" ".githooks"

# The deps filter: a stub worktree_deps.py prints one line of each kind.
# Only the two lines that found node_modules matching the lockfile go;
# every other line prints, the drift line shortened to its counts and fix.
d="$(session_repo deps-filter)"
sgit -C "$d" config core.hooksPath .githooks
mkdir -p "$d/scripts"
cat > "$d/scripts/worktree_deps.py" <<'PY'
import sys
if "--session-dir" in sys.argv:
    sys.exit(0)
print("cs-site deps: main checkout; node_modules matches package-lock.json; nothing to seed")
print("cs-site deps: node_modules present and matches package-lock.json; left alone")
print("cs-site deps: node_modules present; left alone")
print("cs-site deps: main checkout; nothing to seed")
print("cs-site deps: INFO node_modules does not match package-lock.json: 2 missing (a, b). It was left alone. Run npm install --no-audit --no-fund, not npm ci, which swaps the clone.")
print("cs-site deps: INFRA could not read package-lock.json: missing.")
PY
out="$(cd "$d" && GIT_CONFIG_GLOBAL="$SESSION_GLOBAL" GIT_CONFIG_NOSYSTEM=1 CLAUDE_PROJECT_DIR="$d" \
         bash .claude/hooks/cs-site-session-start.sh 2>&1)"
deps_ok=1
for gone in "node_modules matches package-lock.json; nothing to seed" "node_modules present and matches package-lock.json"; do
  grep -qF -- "$gone" <<<"$out" && { deps_ok=0; echo "  still printed: $gone"; }
done
for kept in "cs-site deps: node_modules present; left alone" "cs-site deps: main checkout; nothing to seed" \
  "cs-site deps: INFO node_modules does not match package-lock.json: 2 missing; left alone. Fix: npm install --no-audit --no-fund, never npm ci." \
  "cs-site deps: INFRA could not read package-lock.json: missing."; do
  grep -qF -- "$kept" <<<"$out" || { deps_ok=0; echo "  missing: $kept"; }
done
if [ "$deps_ok" -eq 1 ]; then
  pass "session start, the deps filter drops only the matching lines"
else
  fail "session start, the deps filter drops only the matching lines"
  printf '%s\n' "$out" | tail -8
fi

if [ "$failures" -ne 0 ]; then
  echo "hook-selftest: FAIL ($failures step(s) misbehaved)"
  exit 1
fi
echo "hook-selftest: PASS"
exit 0
