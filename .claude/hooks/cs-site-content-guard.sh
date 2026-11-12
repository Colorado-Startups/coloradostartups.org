#!/usr/bin/env bash
# coloradostartups-site: content guard. ADVISORY.
#
# Wired in .claude/settings.json under PostToolUse, matcher "Write|Edit".
# FIRES on every Write and Edit. (The settings file is the authority on that
# wiring, not this comment; 04_tools/contract_test.py C8 checks they agree.)
#
# This file ROUTES. It sends the edited file to 04_tools/cs_site_lint.py and
# relays the answer. The lint decides scope, so a file outside data/ or art/
# comes back clean and this hook stays quiet. No rule lives here.
#
# PostToolUse runs after the write, so this cannot stop it. On a FAIL it
# prints the findings to stderr and exits 2, which Claude Code shows to
# Claude so the file gets fixed before commit. pre-commit is where the same
# lint blocks. Anything else, including an infrastructure problem, exits 0.

set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
LINT="$PROJECT_DIR/04_tools/cs_site_lint.py"
PY="${CS_SITE_PYTHON:-python3}"

command -v "$PY" >/dev/null 2>&1 || exit 0
[ -r "$LINT" ] || exit 0

target="$("$PY" -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
print((d.get("tool_input") or {}).get("file_path", ""))
' 2>/dev/null || true)"

[ -n "$target" ] || exit 0
[ -f "$target" ] || exit 0

rc=0
out="$("$PY" "$LINT" --root "$PROJECT_DIR" --quiet "$target" 2>&1)" || rc=$?

if [ "$rc" -eq 1 ]; then
  {
    echo "cs-site-content-guard: blocking findings in $target"
    echo "(the edit is saved; .githooks/pre-commit will refuse it until fixed)"
    printf '%s\n' "$out" | grep -E ' (FAIL|WARN) \[' | head -20
  } >&2
  exit 2
fi
exit 0
