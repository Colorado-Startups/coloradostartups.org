#!/usr/bin/env bash
# coloradostartups-site shared hook router. Sourced by pre-commit and pre-push.
#
# THIS FILE ROUTES. IT DOES NOT DECIDE.
#
# House rule (~/.claude/rules/writing-and-gates.md): "The hook routes, it does
# not decide." Every term, severity, scope glob and date window lives in
# 04_tools/cs_site_rules.json and is applied by 04_tools/cs_site_lint.py.
# Nothing below knows what an em dash is or which files are in scope: every
# staged file goes to the lint, and the lint skips what is out of scope.
#
# Exit contract of every checker (04_tools/README.md):
#   0 clean   1 blocking finding   2 usage error   3 could NOT check
# 2 and 3 are INFRA here: warn and pass. Could not verify is not the same as
# verified and red, so a missing python3, a missing node_modules or a broken
# rules file never looks like a content violation.
#
# What is checked is the snapshot being committed or pushed, not the working
# tree: snapshot_files copies each file out of the index (pre-commit) or out
# of the pushed commit (pre-push) into a temp directory first. A file staged
# with an em dash and then fixed only in the working tree is still caught.

set -uo pipefail

REPO_ROOT="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
TOOLS="$REPO_ROOT/04_tools"
PY="${CS_SITE_PYTHON:-python3}"

blocked=0
infra=0
SNAP=""

cleanup_snapshot() {
  [ -n "$SNAP" ] && [ -d "$SNAP" ] && rm -rf "$SNAP"
  SNAP=""
}

# snapshot_files SPEC FILES: copy each file as git stores it into $SNAP.
# SPEC is "" for the index (git show :path) or a commit sha (git show sha:path).
snapshot_files() {
  local spec="$1" files="$2" f tmpbase="${TMPDIR:-/tmp}"
  [ -n "$SNAP" ] || SNAP="$(mktemp -d "${tmpbase%/}/cs-site-snap.XXXXXX")"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    mkdir -p "$SNAP/$(dirname "$f")"
    git show "$spec:$f" > "$SNAP/$f" 2>/dev/null || rm -f "$SNAP/$f"
  done <<< "$files"
}

# Run one checker and translate its exit code. Knows nothing about the check.
run_checker() {
  local label="$1"; shift
  local out rc=0
  out="$("$@" 2>&1)" || rc=$?
  [ -n "$SNAP" ] && out="$(printf '%s\n' "$out" | sed "s|$SNAP/||g")"
  case "$rc" in
    0) : ;;
    1) blocked=1
       echo >&2
       echo "  BLOCKED [$label]" >&2
       printf '%s\n' "$out" | grep -E 'FAIL|broken|error|Error|secret' | head -30 >&2 ;;
    2|3)
       infra=1
       echo "  INFRA [$label]: could not verify (exit $rc), passing" >&2
       printf '%s\n' "$out" | grep -E '^INFRA|usage' | head -5 >&2 ;;
    *) infra=1
       echo "  INFRA [$label]: checker exited $rc, passing" >&2
       printf '%s\n' "$out" | tail -5 >&2 ;;
  esac
  # Warnings never change the outcome, and most sit on lines this commit did
  # not touch, so the hook prints none of them, not even a count: every later
  # model call re-reads what a hook prints (blockers.hook_tokens_per_session,
  # about 12K tokens a session for the count). CI's content-gates job prints
  # them (decision 104).
  return 0
}

# Where secretlint is installed, if anywhere. Prints the directory.
secretlint_home() {
  local d
  for d in "$REPO_ROOT" "$REPO_ROOT/site"; do
    if [ -x "$d/node_modules/.bin/secretlint" ] \
       && [ -d "$d/node_modules/@secretlint/secretlint-rule-preset-recommend" ]; then
      printf '%s\n' "$d"
      return 0
    fi
  done
  return 1
}

# route_all PHASE FILES: run every per-file gate over $SNAP.
route_all() {
  local phase="$1" files="$2"
  [ -z "$files" ] && return 0

  if ! command -v "$PY" >/dev/null 2>&1; then
    infra=1
    echo "  INFRA [content, contract]: $PY not found; skipped (fail open)" >&2
  else
    local snap_paths=() f
    while IFS= read -r f; do
      [ -n "$f" ] && [ -f "$SNAP/$f" ] && snap_paths+=("$SNAP/$f")
    done <<< "$files"

    # 1. Content lint. The lint decides scope; out-of-scope files pass silently.
    if [ "${#snap_paths[@]}" -gt 0 ]; then
      run_checker "content" "$PY" "$TOOLS/cs_site_lint.py" --root "$SNAP" --quiet "${snap_paths[@]}"
    fi
  fi

  # 2. Secrets. secretlint is a dev dependency; without node_modules it cannot
  # run, which is an infrastructure condition, not a clean result.
  local home
  if home="$(secretlint_home)"; then
    local snap_list=() f2
    while IFS= read -r f2; do
      [ -n "$f2" ] && [ -f "$SNAP/$f2" ] && snap_list+=("$SNAP/$f2")
    done <<< "$files"
    if [ "${#snap_list[@]}" -gt 0 ]; then
      run_secretlint "$home" "${snap_list[@]}"
    fi
  else
    infra=1
    echo "  INFRA [secret]: secretlint not installed here; secret scan skipped. CI's secret-scan still runs. To seed node_modules: python3 -I scripts/worktree_deps.py (never npm ci)." >&2
  fi

  # 3. The contract test: the gates, the settings and the gate table in
  # .claude/rules/site-gates.md still agree.
  if command -v "$PY" >/dev/null 2>&1; then
    run_checker "contract" "$PY" "$TOOLS/contract_test.py"
  fi
  return 0
}

run_secretlint() {
  local home="$1"; shift
  local out rc=0
  out="$(cd "$home" && npm_config_loglevel=error npx --no-install secretlint --no-glob --no-gitignore \
          --secretlintrc "$REPO_ROOT/.secretlintrc.json" "$@" 2>&1)" || rc=$?
  [ -n "$SNAP" ] && out="$(printf '%s\n' "$out" | sed "s|$SNAP/||g")"
  case "$rc" in
    0) : ;;
    1) blocked=1
       echo >&2; echo "  BLOCKED [secret]" >&2
       printf '%s\n' "$out" | tail -25 >&2 ;;
    *) infra=1
       echo "  INFRA [secret]: secretlint exited $rc, passing" >&2
       printf '%s\n' "$out" | tail -5 >&2 ;;
  esac
}

# Print the verdict and return 1 if anything blocked.
route_verdict() {
  local phase="$1"
  if [ "$blocked" -ne 0 ]; then
    echo >&2
    if [ "$phase" = "pre-commit" ]; then
      echo "Nothing was committed. Fix the blocking findings above." >&2
      echo "pre-push runs the same checks, so --no-verify only defers them." >&2
    else
      echo "Nothing was pushed. Fix the blocking findings and commit the fix." >&2
      echo "The ruleset on main requires no status check, so this hook is the" >&2
      echo "blocking gate." >&2
    fi
    return 1
  fi
  if [ "$infra" -ne 0 ]; then
    echo >&2
    echo "Some checks could not run (see INFRA above). Proceeding, because" >&2
    echo "could not verify is not the same as verified and red." >&2
  fi
  return 0
}
