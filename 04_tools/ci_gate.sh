#!/usr/bin/env bash
# ci_gate.sh: run one checker in CI and apply the exit contract to its code.
#
# THIS FILE ROUTES. IT DOES NOT DECIDE. It knows nothing about any check.
# It is the one definition of how CI reads a checker's exit code, so no
# workflow carries its own copy of that logic in YAML.
#
# Exit contract of every checker (04_tools/README.md):
#   0 clean   1 blocking finding   2 usage error   3 could NOT check
# In CI:
#   3 becomes 0, with a GitHub ::warning:: line naming the command. Could not
#     verify is not the same as verified and red.
#   2 stays 2, so the run goes red. In CI a usage error means the workflow
#     itself calls the checker wrong, and only a red run gets that fixed.
#   Every other code passes through unchanged.
#
# Called from .github/workflows/site-tests.yml and content-gates.yml, which
# are advisory (the org ruleset on main requires a pull request and no status
# check, gh api repos/Colorado-Startups/coloradostartups-site/rulesets).
# contract_test.py C9c checks that every workflow lint call goes through here.
# hook_selftest.sh proves the mapping for exit codes 0, 1, 2 and 3.
#
# Usage:  bash 04_tools/ci_gate.sh COMMAND [ARG...]
#         bash 04_tools/ci_gate.sh npm run lint:built
# Exit:   the command's code, except 3 becomes 0; 2 when no command is given.

set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: bash 04_tools/ci_gate.sh COMMAND [ARG...]" >&2
  exit 2
fi

rc=0
"$@" || rc=$?

if [ "$rc" -eq 3 ]; then
  cmd="$*"
  # GitHub workflow commands end at a newline. Escape the message so a file
  # name cannot end this line early and start a second command.
  cmd="${cmd//'%'/%25}"
  cmd="${cmd//$'\r'/%0D}"
  cmd="${cmd//$'\n'/%0A}"
  echo "::warning title=could not check (exit 3)::${cmd} could not check, which is not the same as verified and red; passing"
  exit 0
fi
exit "$rc"
