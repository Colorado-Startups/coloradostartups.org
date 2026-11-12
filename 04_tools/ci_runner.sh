#!/usr/bin/env bash
# ci_runner.sh: the runs-on label for CI's test jobs, from the CI_RUNNER variable.
#
# The one place this repo's workflows read CI_RUNNER. Passed raw to runs-on,
# the variable would send a job to any label: a larger runner that bills per
# minute, or a self-hosted one. The org has 1 Blacksmith self-hosted runner
# registered, offline, in 4 Blacksmith runner groups (gh api
# orgs/Colorado-Startups/actions/runners and runner-groups, 2026-11-03), and
# the managed policy bans any runner on this Mac (2026-10-25). The rule is
# free or subscription compute only.
#
# The rules mirror runner() in the shared cloud-test workflow
# (Colorado-Startups/.github, cloud-test/cloud_test.py), so the org has one
# runner definition; change both together. Surrounding whitespace is dropped.
# Empty means ubuntu-latest. A standard GitHub-hosted x64 Linux label passes,
# since the plan's included minutes cover it; ubuntu-slim suits only jobs of a
# few seconds. A blacksmith-* label passes with a warning, since Blacksmith
# runs only on its free tier after Paul's yes. Anything else exits 1: arm and
# larger runners may bill outside the included minutes, and self-hosted labels
# and groups run on machines this org does not want running CI.
# The change jobs in site-tests.yml and e2e.yml call it and hand the label to
# the test jobs; site-tests.yml runs the self-test.
#
# Usage:  CI_RUNNER=<value> bash 04_tools/ci_runner.sh
#         bash 04_tools/ci_runner.sh --self-test
# Output: runner=<label> on stdout, and appended to $GITHUB_OUTPUT when set.
# Exit:   0 resolved, 1 a value outside the rules, 2 usage error.
set -uo pipefail

STANDARD=(ubuntu-latest ubuntu-24.04 ubuntu-22.04 ubuntu-slim)
BLACKSMITH='^blacksmith-[a-z0-9-]{1,60}$'

resolve() {
  local want="${1:-}" label ok=""
  want="${want#"${want%%[![:space:]]*}"}"
  want="${want%"${want##*[![:space:]]}"}"
  [ -z "$want" ] && want=ubuntu-latest
  for label in "${STANDARD[@]}"; do
    [ "$want" = "$label" ] && ok=1
  done
  if [ -z "$ok" ] && [[ "$want" =~ $BLACKSMITH ]]; then
    echo "::warning title=CI_RUNNER::CI_RUNNER names Blacksmith. Run there only on its free tier after Paul's yes, and only while the account stops at the free limit instead of billing."
    ok=1
  fi
  if [ -z "$ok" ]; then
    # The value goes into a workflow command, so anything outside a label's
    # characters is replaced before it is printed.
    echo "::error title=CI_RUNNER::\"${want//[^A-Za-z0-9._-]/?}\" is not a standard GitHub-hosted Linux label (${STANDARD[*]}) or a blacksmith-* label"
    return 1
  fi
  echo "runner=$want"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "runner=$want" >> "$GITHUB_OUTPUT"; fi
}

# Seeded known-clean and known-bad values, the shared workflow's own cases
# plus arm, JSON and whitespace. Each must resolve, or be refused without
# writing to GITHUB_OUTPUT.
self_test() {
  local wrong=0 out value want shown
  out="$(mktemp "${TMPDIR:-/tmp}/ci-runner-selftest.XXXXXX")" || { echo "  FAIL could not make a temp file"; return 1; }
  while IFS='|' read -r value want; do
    : > "$out"
    if GITHUB_OUTPUT="$out" resolve "$value" >/dev/null && [ "$(cat "$out")" = "runner=$want" ]; then
      echo "  OK   \"$value\" resolves to $want"
    else
      echo "  FAIL \"$value\" should resolve to $want"; wrong=$((wrong + 1))
    fi
  done <<'CLEAN'
|ubuntu-latest
ubuntu-latest|ubuntu-latest
ubuntu-24.04|ubuntu-24.04
ubuntu-22.04|ubuntu-22.04
ubuntu-slim|ubuntu-slim
ubuntu-latest |ubuntu-latest
 ubuntu-24.04|ubuntu-24.04
blacksmith-2vcpu-ubuntu-2404|blacksmith-2vcpu-ubuntu-2404
CLEAN
  # A here-string, not a pipe: grep -q stops at its first match, and under
  # pipefail a writer that then hits the closed pipe would fail a pass (#542).
  if grep -q '^::warning' <<<"$(resolve blacksmith-2vcpu-ubuntu-2404)"; then
    echo "  OK   a blacksmith-* label warns"
  else
    echo "  FAIL a blacksmith-* label should warn"; wrong=$((wrong + 1))
  fi
  for value in self-hosted '{"group": "g"}' '["ubuntu-latest"]' '"ubuntu-latest"' ubuntu-latest-4-cores \
               macos-latest "a b" "x; rm -rf /" linux-large ubuntu-24.04-arm ubuntu-22.04-arm \
               "ubuntu-latest,self-hosted" "ubuntu-latest
self-hosted"; do
    : > "$out"
    shown="${value//$'\n'/\\n}"
    if GITHUB_OUTPUT="$out" resolve "$value" >/dev/null || [ -s "$out" ]; then
      echo "  FAIL \"$shown\" should be refused"; wrong=$((wrong + 1))
    else
      echo "  OK   \"$shown\" is refused"
    fi
  done
  rm -f "$out"
  if [ "$wrong" -eq 0 ]; then echo "ci_runner.sh self-test: PASS"; return 0; fi
  echo "ci_runner.sh self-test: FAIL ($wrong)"
  return 1
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit $?
fi
if [ "$#" -gt 0 ]; then
  echo "usage: CI_RUNNER=<value> bash 04_tools/ci_runner.sh | bash 04_tools/ci_runner.sh --self-test" >&2
  exit 2
fi
resolve "${CI_RUNNER:-}"
