#!/usr/bin/env bash
# pr_shape.sh: warn when a pull request changes code without a test, or
# changes more than 400 lines. ADVISORY: both are heuristics (house gate
# rules, ~/.claude/rules/gates.md), so this prints ::warning:: lines and never
# fails a run.
#
# The rules copy the Claude tab's, so a warning here is a PR that would count
# against claude.code_prs_with_tests_share (goal 80%) or
# claude.lines_per_merged_pr (goal 400) on the Quality page:
#   code   CODE_FILE, not TEST_FILE, not CONFIG_FILE (Code-OS collectors/claude.mjs)
#   test   TEST_FILE (same file)
#   lines  additions plus deletions, less NOT_REVIEWED files (lockfiles, data
#          snapshots; Code-OS collectors/github.mjs)
# If those regexes change, change these in the same PR.
#
# Usage:
#   bash 04_tools/pr_shape.sh            in CI: reads PR_NUMBER and
#                                        GITHUB_REPOSITORY, lists the PR's
#                                        files with gh api (GH_TOKEN)
#   bash 04_tools/pr_shape.sh --stdin    reads "path<TAB>additions<TAB>deletions" lines
#   bash 04_tools/pr_shape.sh --self-test
# Exit (04_tools/README.md): 0 checked (warnings allowed), 2 usage error,
# 3 could not check (no PR number, no gh or jq, the API call failed).

set -uo pipefail

MAX_LINES=400
CODE_FILE='\.(astro|[cm]?[jt]sx?|py|sh)$'
TEST_FILE='(^|/)(__tests__|tests?|e2e|fixtures)/|[._-](test|spec)\.[cm]?[jt]sx?$|(^|/)test_[^/]*\.py$|_test\.(py|sh)$|selftest'
CONFIG_FILE='(^|/)[^/]*\.config\.[cm]?[jt]s$'
NOT_REVIEWED='(^|/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum)$|^quality/(data|history)/|(^|/)generated/|^evals/[^/]+/cache/|^scripts/canvas/link-check\.json$|^data/events/'

# shape: read "path<TAB>additions<TAB>deletions" lines on stdin, print one
# ::warning:: line per heuristic the change breaks, and a summary line.
shape() {
  local path add del code=0 test=0 lines=0 first_code=""
  while IFS=$'\t' read -r path add del; do
    [ -n "$path" ] || continue
    if grep -qE "$TEST_FILE" <<<"$path"; then
      test=1
    elif grep -qE "$CODE_FILE" <<<"$path" && ! grep -qE "$CONFIG_FILE" <<<"$path"; then
      code=1
      [ -n "$first_code" ] || first_code="$path"
    fi
    grep -qE "$NOT_REVIEWED" <<<"$path" || lines=$((lines + ${add:-0} + ${del:-0}))
  done
  if [ "$code" = 1 ] && [ "$test" = 0 ]; then
    echo "::warning title=No test change::This PR changes code ($first_code) and no test, spec, fixture or self-test. Add or change one that fails without the fix, or say in the PR body why none can."
  fi
  if [ "$lines" -gt "$MAX_LINES" ]; then
    echo "::warning title=Over $MAX_LINES lines::This PR changes $lines reviewed lines (lockfiles and data snapshots left out). Split it into one PR per change where it can be split."
  fi
  echo "pr-shape: code=$code test=$test lines=$lines"
}

self_test() {
  local fails=0 out
  check() { # check LABEL WANT_PATTERN DONT_WANT_PATTERN INPUT
    out="$(printf '%b' "$4" | shape)"
    if { [ -n "$2" ] && ! grep -qF -- "$2" <<<"$out"; } || { [ -n "$3" ] && grep -qF -- "$3" <<<"$out"; }; then
      echo "pr-shape self-test: FAIL $1: $out"; fails=$((fails + 1))
    else
      echo "pr-shape self-test: OK $1"
    fi
  }
  check "code with no test warns" "No test change" "" 'site/src/lib/a.ts\t10\t2\n'
  check "code with a test passes" "code=1 test=1" "No test change" 'site/src/lib/a.ts\t10\t2\nsite/test/unit/a.test.ts\t5\t0\n'
  check "a self-test counts as a test" "test=1" "No test change" 'scripts/x.py\t3\t1\n04_tools/hook_selftest.sh\t2\t2\n'
  check "a config file is not code" "code=0" "No test change" 'site/astro.config.mjs\t4\t1\n'
  check "docs alone warn of nothing" "code=0 test=0 lines=30" "::warning" 'README.md\t20\t10\n'
  check "401 reviewed lines warn" "Over 400 lines" "" 'docs/a.md\t300\t101\n'
  check "400 lines pass" "lines=400" "Over 400" 'docs/a.md\t300\t100\n'
  check "a lockfile is left out of lines" "lines=10" "Over 400" 'package-lock.json\t5000\t4000\ndocs/a.md\t5\t5\n'
  check "a data snapshot is left out of lines" "lines=0" "Over 400" 'quality/data/local.json\t900\t900\n'
  [ "$fails" -eq 0 ] && echo "pr-shape self-test: PASS" && return 0
  echo "pr-shape self-test: FAIL ($fails)"; return 1
}

case "${1:-}" in
  --self-test) self_test; exit $? ;;
  --stdin) shape; exit 0 ;;
  "") ;;
  *) echo "usage: pr_shape.sh [--stdin | --self-test]" >&2; exit 2 ;;
esac

if [ -z "${PR_NUMBER:-}" ] || [ -z "${GITHUB_REPOSITORY:-}" ]; then
  echo "pr-shape: no PR_NUMBER or GITHUB_REPOSITORY; not a pull request run" >&2; exit 3
fi
command -v gh >/dev/null 2>&1 && command -v jq >/dev/null 2>&1 || { echo "pr-shape: gh or jq missing" >&2; exit 3; }
files="$(gh api --paginate "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER/files?per_page=100" \
  --jq '.[] | [.filename, .additions, .deletions] | @tsv' 2>/dev/null)" \
  || { echo "pr-shape: could not list the PR's files" >&2; exit 3; }
shape <<<"$files"
exit 0
