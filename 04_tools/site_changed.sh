#!/usr/bin/env bash
# site_changed.sh: decide whether a change touched a CI suite's inputs.
#
# The one definition of which paths count as each suite's inputs (#336).
# .github/workflows/site-tests.yml and e2e.yml call it instead of each carrying
# a copy of the path regex. The two lists differ on purpose, side by side
# below: e2e serves only the static dist/, so a change only under workers/,
# evals/ or ops/ (check:push tests all three) runs site-tests and skips e2e.
# A change to this file, to .npmrc (npm ci reads it, #272) or to the brand
# tokens the prebuild reads runs both.
# The content lint, its rules and voice_lint run site-tests, whose lint:built
# step reads the real build, so a rule change meets the site on its own pull
# request (#808 review).
#
# A third suite, process-page, is the Process page step of quality-pages.yml
# on a pull request: the site's own process files, the metric definitions it
# reads, and the workflow, which pins Code-OS's pages action (its code lives
# in Code-OS, so a pin bump is the change). A pull request that changes only
# other quality/ files (its evals collector, data and config) skips it; the
# push to main always builds both pages, since that run passes no base.
#
# Two more questions, for site-tests on a push to main (#569):
#   hash SUITE         a hash of every tracked SUITE input (mode, blob, path)
#   passed SUITE HASH  did the pull request this push merged pass SUITE on
#                      those exact inputs? A pull request's test job uploads
#                      the artifact SUITE-inputs-HASH; passed=true needs that
#                      artifact from a successful pull_request run of
#                      .github/workflows/SUITE.yml in this repo, on the head
#                      of the pull request whose merge commit is GITHUB_SHA.
#                      Anything it cannot read or prove is passed=false, so
#                      the suite runs.
#
# Usage:  bash 04_tools/site_changed.sh SUITE BASE   SUITE: site-tests, e2e or process-page
#         bash 04_tools/site_changed.sh hash SUITE
#         bash 04_tools/site_changed.sh passed SUITE HASH   (needs gh, GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA)
#                                                    BASE: the commit HEAD is compared with
#         bash 04_tools/site_changed.sh --self-test
# Output: run=true or run=false on stdout, and appended to $GITHUB_OUTPUT when
#         that is set, with one line saying why.
# Fails open: an empty, all-zero or unknown BASE, or a git diff that fails,
#         means run=true. The suite runs rather than passing unchecked.
# Exit:   0 decided, 2 usage error (no or unknown SUITE).
set -uo pipefail

COMMON='site/|packages/|data/|art/|scripts/|01_doctrine/brand_tokens\.yaml$|package(-lock)?\.json$|\.npmrc$|\.nvmrc$|04_tools/site_changed\.sh$'

# The anchored pattern for SUITE, or nothing for an unknown suite.
pattern() {
  case "$1" in
    site-tests) printf '^(%s|workers/|evals/|ops/|04_tools/(cs_site_lint(_[a-z]+)?\\.py|cs_site_rules\\.json|voice_lint\\.py)$|\\.github/workflows/site-tests\\.yml$)' "$COMMON" ;;
    e2e) printf '^(%s|\\.github/workflows/e2e\\.yml$)' "$COMMON" ;;
    process-page) printf '^(quality/process/|quality/targets/|04_tools/site_changed\\.sh$|\\.github/workflows/quality-pages\\.yml$)' ;;
    *) return 1 ;;
  esac
}

# Reads changed paths on stdin; succeeds when any is an input of SUITE.
# grep reads all of stdin, not -q: -q stops at the first match, and under
# pipefail the writer's SIGPIPE (141) would turn a match into "skip".
touches() {
  local re
  re="$(pattern "$1")" || return 2
  grep -E "$re" >/dev/null
}

decide() {
  local suite="$1" base="${2:-}" run reason changed rc
  if ! pattern "$suite" >/dev/null; then
    echo "usage: bash 04_tools/site_changed.sh site-tests|e2e|process-page BASE | --self-test" >&2
    return 2
  fi
  if [ -z "$base" ] || [ "$base" = "0000000000000000000000000000000000000000" ] \
     || ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
    run=true reason="No usable base commit; running the $suite suite."
  # --no-renames lists a moved file under its old path too, so a file moved
  # out of site/ still counts as a site change (#515).
  elif ! changed="$(git diff --name-only --no-renames "$base" HEAD)"; then
    run=true reason="git diff failed; running the $suite suite."
  else
    # grep: 0 a match, 1 none, 2 or more it could not check. Could not check
    # runs the suite, never skips it (#372).
    printf '%s\n' "$changed" | touches "$suite"
    rc=$?
    case "$rc" in
      0) run=true reason="$suite inputs changed; running the suite." ;;
      1) run=false reason="No $suite inputs changed; the suite does not apply, passing." ;;
      *) run=true reason="Could not check the change list (grep exit $rc); running the $suite suite." ;;
    esac
  fi
  echo "$reason"
  echo "run=$run"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "run=$run" >> "$GITHUB_OUTPUT"; fi
  return 0
}

# Prints hash=<sha1> of SUITE's tracked inputs; hash= (empty) when git fails.
inputs_hash() {
  local suite="$1" re list h
  re="$(pattern "$suite")" || { echo "usage: bash 04_tools/site_changed.sh hash site-tests|e2e|process-page" >&2; return 2; }
  if list="$(git ls-files -s)" && h="$(printf '%s\n' "$list" | RE="$re" awk -F'\t' '$2 ~ ENVIRON["RE"]' | git hash-object --stdin)"; then
    echo "hash=$h"
  else
    echo "hash="
  fi
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "hash=${h:-}" >> "$GITHUB_OUTPUT"; fi
  return 0
}

passed_check() {
  local suite="$1" want="${2:-}" repo="${GITHUB_REPOSITORY:-}" sha="${GITHUB_SHA:-}" passed=false reason head ids id info
  if ! pattern "$suite" >/dev/null; then
    echo "usage: bash 04_tools/site_changed.sh passed site-tests|e2e|process-page HASH" >&2
    return 2
  fi
  if [ -z "$want" ] || [ -z "$repo" ] || [ -z "$sha" ]; then
    reason="No inputs hash, repository or commit; running the $suite suite."
  elif ! head="$(gh api "repos/$repo/commits/$sha/pulls" --jq ".[] | select(.merge_commit_sha == \"$sha\") | .head.sha" 2>/dev/null)" || [ -z "$head" ] || [ "$(printf '%s\n' "$head" | wc -l)" -ne 1 ]; then
    reason="This push is not one pull request's merge commit; running the $suite suite."
  elif ! ids="$(gh api "repos/$repo/actions/artifacts?name=$suite-inputs-$want&per_page=20" --jq '.artifacts[] | select(.expired | not) | .workflow_run.id' 2>/dev/null)"; then
    reason="Could not list artifacts; running the $suite suite."
  else
    reason="The merged pull request never passed $suite on these inputs; running the suite."
    for id in $ids; do
      info="$(gh api "repos/$repo/actions/runs/$id" --jq '[.path, .event, .conclusion, .head_sha, .head_repository.full_name] | join(" ")' 2>/dev/null)" || continue
      if [ "$info" = ".github/workflows/$suite.yml pull_request success $head $repo" ]; then
        passed=true reason="Run $id passed $suite on the merged pull request's head with these exact inputs; not running it again."
        break
      fi
    done
  fi
  echo "$reason"
  echo "passed=$passed"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "passed=$passed" >> "$GITHUB_OUTPUT"; fi
  return 0
}

self_test() {
  local wrong=0 suite path want got
  # Known-bad and known-clean paths for each suite: SUITE PATH run|skip.
  while read -r suite path want; do
    if printf '%s\n' "$path" | touches "$suite"; then got=run; else got=skip; fi
    if [ "$got" = "$want" ]; then echo "  OK   $suite $path: $got"; else echo "  FAIL $suite $path: $got, expected $want"; wrong=$((wrong + 1)); fi
  done <<'SAMPLES'
site-tests site/src/pages/index.astro run
site-tests workers/communitas/src/index.ts run
site-tests packages/shared/src/index.ts run
site-tests package-lock.json run
site-tests .github/workflows/site-tests.yml run
site-tests 04_tools/site_changed.sh run
site-tests 04_tools/cs_site_lint.py run
site-tests 04_tools/cs_site_lint_extract.py run
site-tests 04_tools/cs_site_rules.json run
site-tests 04_tools/voice_lint.py run
site-tests 04_tools/contract_test.py skip
e2e 04_tools/cs_site_rules.json skip
site-tests .github/workflows/e2e.yml skip
site-tests 00_project_system/PLAN.md skip
site-tests site-extra/notes.md skip
site-tests docs/package.json skip
e2e data/team/dwarves.yaml run
e2e .nvmrc run
e2e .github/workflows/e2e.yml run
e2e 04_tools/site_changed.sh run
e2e workers/communitas/src/index.ts skip
e2e .github/workflows/site-tests.yml skip
e2e quality/collectors/evals.mjs skip
site-tests 01_doctrine/brand_tokens.yaml run
site-tests evals/ai-visibility/test/cli.test.ts run
site-tests 01_doctrine/voice.md skip
e2e 01_doctrine/brand_tokens.yaml run
e2e evals/ai-visibility/test/cli.test.ts skip
site-tests ops/redirects/map.mjs run
e2e ops/redirects/map.mjs skip
site-tests .npmrc run
e2e .npmrc run
site-tests docs/.npmrc skip
process-page quality/process/config.json run
process-page quality/process/maps.json run
process-page quality/targets/ci.json run
process-page package.json skip
process-page .claude-os-managed.json skip
process-page 04_tools/site_changed.sh run
process-page .github/workflows/quality-pages.yml run
process-page quality/collectors/evals.mjs skip
process-page quality/config.json skip
process-page site/src/pages/index.astro skip
process-page docs/code-os/notes.md skip
SAMPLES

  # The git half, in a throwaway repo: a site change runs, a docs-only change
  # skips, an unusable base runs, a bad suite is a usage error, and the
  # decision lands in GITHUB_OUTPUT.
  local repo out base rc
  repo="$(mktemp -d "${TMPDIR:-/tmp}/site-changed-selftest.XXXXXX")" || { echo "  FAIL could not make a throwaway repo"; return 1; }
  out="$repo.out"
  (
    cd "$repo" || exit 1
    git init -q && git config user.email selftest@example.invalid && git config user.name selftest
    mkdir -p site docs && echo a > site/a.txt && echo a > docs/a.md
    git add -A && git commit -qm base
  ) || { echo "  FAIL could not seed the throwaway repo"; rm -rf "$repo" "$out"; return 1; }
  base="$(git -C "$repo" rev-parse HEAD)"
  check() { # NAME WANT-LINE ARGS...
    local name="$1" want="$2"; shift 2
    : > "$out"
    if [ "$(cd "$repo" && GITHUB_OUTPUT="$out" decide "$@" | tail -1)" = "$want" ] && [ "$(cat "$out")" = "$want" ]; then
      echo "  OK   $name: $want"
    else
      echo "  FAIL $name: expected $want"; wrong=$((wrong + 1))
    fi
  }
  (cd "$repo" && echo b > docs/a.md && git commit -qam docs)
  check "a docs-only change skips e2e" "run=false" e2e "$base"
  # A grep that errors (exit 2) on that same docs-only change: could not
  # check must run the suite, not skip it (#372). The stub grep comes first
  # on PATH, so the script needs no test hook.
  local stub
  stub="$(mktemp -d "${TMPDIR:-/tmp}/site-changed-grep.XXXXXX")" && printf '#!/bin/sh\nexit 2\n' > "$stub/grep" && chmod +x "$stub/grep"
  PATH="$stub:$PATH" check "a grep that errors runs the suite" "run=true" e2e "$base"
  rm -rf "$stub"
  (cd "$repo" && echo b > site/a.txt && git commit -qam site)
  check "a site change runs e2e" "run=true" e2e "$base"
  check "an empty base runs" "run=true" site-tests ""
  check "an all-zero base runs" "run=true" site-tests "0000000000000000000000000000000000000000"
  check "an unknown base runs" "run=true" site-tests "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
  # A change list past the 64 KB pipe buffer whose first path matches. grep
  # stops at the match; under pipefail the writer's SIGPIPE must not turn
  # that into "does not apply" (the #343 review reproduced it with 2,500 files).
  local wide
  wide="$(git -C "$repo" rev-parse HEAD)"
  local long
  long="zz/$(printf 'p%.0s' $(seq 1 200))"
  (cd "$repo" && echo c > site/a.txt && mkdir -p "$long" && for i in $(seq -w 1 2500); do echo x > "$long/padding-$i.txt"; done && git add -A && git commit -qm wide)
  check "a 2,500-path change list of about 550 KB whose first path matches runs" "run=true" site-tests "$wide"
  # A file moved out of site/. Rename detection would list only docs/a.txt,
  # and the suite would skip although the site lost a file (#515).
  local moved
  moved="$(git -C "$repo" rev-parse HEAD)"
  (cd "$repo" && git mv site/a.txt docs/a.txt && git commit -qm moved)
  check "a file moved from site/ to docs/ runs" "run=true" site-tests "$moved"
  # The inputs hash: a docs-only commit keeps it, a site change moves it.
  local h1 h2 h3
  h1="$(cd "$repo" && inputs_hash site-tests | tail -1)"
  (cd "$repo" && echo d > docs/b.md && git add -A && git commit -qm docs2)
  h2="$(cd "$repo" && inputs_hash site-tests | tail -1)"
  (cd "$repo" && echo e > site/b.txt && git add -A && git commit -qm site2)
  h3="$(cd "$repo" && inputs_hash site-tests | tail -1)"
  if [ "${#h1}" = 45 ] && [ "$h1" = "$h2" ]; then echo "  OK   a docs-only commit keeps the inputs hash"; else echo "  FAIL a docs-only commit changed the inputs hash ($h1, $h2)"; wrong=$((wrong + 1)); fi
  if [ "$h2" != "$h3" ]; then echo "  OK   a site change moves the inputs hash"; else echo "  FAIL a site change kept the inputs hash"; wrong=$((wrong + 1)); fi

  # passed: a stub gh on PATH answers the three reads from fixtures through
  # jq, as gh --jq does. Only the exact proof passes; every gap runs the suite.
  local stub ghout
  stub="$(mktemp -d "${TMPDIR:-/tmp}/site-changed-gh.XXXXXX")" || { echo "  FAIL could not make a stub dir"; return 1; }
  cat > "$stub/gh" <<'STUB'
#!/usr/bin/env bash
[ "${STUB_FAIL:-}" = 1 ] && exit 1
path="$2" expr=""
[ "${3:-}" = "--jq" ] && expr="$4"
pulls='[{"merge_commit_sha":"m1","head":{"sha":"h1"}}]'
artifacts='{"artifacts":[{"expired":false,"workflow_run":{"id":7}}]}'
run='{"path":".github/workflows/site-tests.yml","event":"pull_request","conclusion":"success","head_sha":"h1","head_repository":{"full_name":"o/r"}}'
case "$path" in
  */pulls) json="${STUB_PULLS-$pulls}" ;;
  */artifacts*) json="${STUB_ARTIFACTS-$artifacts}" ;;
  */runs/*) json="${STUB_RUN-$run}" ;;
  *) exit 1 ;;
esac
printf '%s' "$json" | jq -r "$expr"
STUB
  chmod +x "$stub/gh"
  passcase() { # NAME WANT ENV...
    local name="$1" want="$2"; shift 2
    : > "$out"
    ghout="$(env PATH="$stub:$PATH" GITHUB_REPOSITORY=o/r GITHUB_SHA=m1 GITHUB_OUTPUT="$out" "$@" bash "$self" passed site-tests abc | tail -1)"
    if [ "$ghout" = "$want" ] && [ "$(cat "$out")" = "$want" ]; then echo "  OK   $name: $want"; else echo "  FAIL $name: got $ghout, expected $want"; wrong=$((wrong + 1)); fi
  }
  local self
  self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  passcase "the merged head passed these inputs" "passed=true"
  passcase "gh fails" "passed=false" STUB_FAIL=1
  passcase "no artifact for these inputs" "passed=false" 'STUB_ARTIFACTS={"artifacts":[]}'
  passcase "the artifact expired" "passed=false" 'STUB_ARTIFACTS={"artifacts":[{"expired":true,"workflow_run":{"id":7}}]}'
  passcase "that run failed" "passed=false" 'STUB_RUN={"path":".github/workflows/site-tests.yml","event":"pull_request","conclusion":"failure","head_sha":"h1","head_repository":{"full_name":"o/r"}}'
  passcase "another workflow uploaded it" "passed=false" 'STUB_RUN={"path":".github/workflows/other.yml","event":"pull_request","conclusion":"success","head_sha":"h1","head_repository":{"full_name":"o/r"}}'
  passcase "another pull request's head" "passed=false" 'STUB_RUN={"path":".github/workflows/site-tests.yml","event":"pull_request","conclusion":"success","head_sha":"h2","head_repository":{"full_name":"o/r"}}'
  passcase "a fork's run" "passed=false" 'STUB_RUN={"path":".github/workflows/site-tests.yml","event":"pull_request","conclusion":"success","head_sha":"h1","head_repository":{"full_name":"fork/r"}}'
  passcase "the push is no pull request's merge" "passed=false" 'STUB_PULLS=[]'
  passcase "no commit to look up" "passed=false" GITHUB_SHA=
  rm -rf "$stub"

  (cd "$repo" && decide nightly "$base" >/dev/null 2>&1); rc=$?
  if [ "$rc" = 2 ]; then echo "  OK   an unknown suite is a usage error: exit 2"; else echo "  FAIL an unknown suite exited $rc, expected 2"; wrong=$((wrong + 1)); fi
  rm -rf "$repo" "$out"

  # Each workflow asks this script about its own suite, and carries no path
  # list of its own (#372: the site-tests header listed one, and it drifted).
  local root wf
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  for suite in site-tests e2e; do
    wf="$root/.github/workflows/$suite.yml"
    if grep -q "bash 04_tools/site_changed.sh $suite " "$wf" 2>/dev/null; then echo "  OK   $suite.yml calls the detector for $suite"; else echo "  FAIL $suite.yml does not call bash 04_tools/site_changed.sh $suite"; wrong=$((wrong + 1)); fi
    if grep -q "steps run only when 04_tools/site_changed.sh" "$wf" 2>/dev/null; then echo "  OK   $suite.yml's header says when steps run by naming the detector"; else echo "  FAIL $suite.yml's header must say the steps run only when 04_tools/site_changed.sh finds an input, not list inputs itself"; wrong=$((wrong + 1)); fi
  done
  # content-gates.yml's path filter must name the folder of every glob the
  # lint covers (cs_site_rules.json scope.content), or a content change would
  # start no run (#577).
  local dirs missing=""
  dirs="$(python3 -I -c 'import json,sys; print("\n".join(sorted({g.split("/")[0] for g in json.load(open(sys.argv[1]))["scope"]["content"]})))' "$root/04_tools/cs_site_rules.json" 2>/dev/null)" || dirs=""
  if [ -z "$dirs" ]; then
    echo "  FAIL could not read scope.content from 04_tools/cs_site_rules.json"; wrong=$((wrong + 1))
  else
    for d in $dirs; do grep -q "^      - \"$d/\*\*\"$" "$root/.github/workflows/content-gates.yml" 2>/dev/null || missing="$missing $d/"; done
    if [ -z "$missing" ]; then echo "  OK   content-gates.yml's path filter names every content folder"; else echo "  FAIL content-gates.yml's path filter is missing:$missing"; wrong=$((wrong + 1)); fi
  fi
  # quality-pages.yml is private (04_tools/export_manifest.json): the public repo has no Process page step to check.
  # Keyed on the archive marker, so a quality-pages.yml deleted by mistake in the archive still fails here.
  if [ ! -f "$root/04_tools/.private-overlay-required" ]; then echo "  SKIP quality-pages.yml stays in the archive repo; this is the public one"
  elif grep -q "bash 04_tools/site_changed.sh process-page " "$root/.github/workflows/quality-pages.yml"; then echo "  OK   quality-pages.yml calls the detector for process-page"; else echo "  FAIL quality-pages.yml does not call bash 04_tools/site_changed.sh process-page"; wrong=$((wrong + 1)); fi

  if [ "$wrong" -eq 0 ]; then echo "site_changed.sh self-test: PASS"; return 0; fi
  echo "site_changed.sh self-test: FAIL ($wrong)"
  return 1
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit $?
fi
if [ "${1:-}" = "hash" ]; then
  inputs_hash "${2:-}"
  exit $?
fi
if [ "${1:-}" = "passed" ]; then
  passed_check "${2:-}" "${3:-}"
  exit $?
fi
decide "${1:-}" "${2:-}"
exit $?
