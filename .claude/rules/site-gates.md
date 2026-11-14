---
paths:
  - ".githooks/**"
  - ".claude/hooks/**"
  - ".claude/settings.json"
  - ".github/**"
  - "04_tools/**"
  - "scripts/worktree_deps.py"
---

# Site gates: which fire and which wait

Moved out of `CLAUDE.md` 2026-11-03 to load only with a gate file (code.claude.com/docs/en/memory, path-scoped rules). `.claude/settings.json`, not a hook's header, is the wiring authority; `contract_test.py` (C5) checks this table against it.

No gate runs a test, build or render on this Mac (Paul, 2026-11-02). Git hooks run the content lint, the secret scan and `contract_test.py`, the one local self-check (about 0.17 s, orchestrator's timing, 2026-11-02). Every other suite and self-test runs in CI, except the last row below. Workflows and merge blocking: [`site-ci.md`](site-ci.md).

| Gate | When | Blocking |
| --- | --- | --- |
| `.claude/hooks/cs-site-content-guard.sh` | **Fires** on every Write and Edit | No. Exit 2 on a FAIL shows Claude the findings; the edit is saved |
| `.claude/hooks/cs-site-session-start.sh` | **Fires** at session start | No. Prints only what to act on. Sets the repo's `core.hooksPath=.githooks` unless a repo or worktree value exists, even over a global or system one; seeds a new worktree's `node_modules` (`scripts/worktree_deps.py`) |
| `.githooks/pre-commit` | **Fires** on every commit | Yes. Prints only what blocks or could not run; CI's `content-gates` shows warnings (2026-11-03; no WARN count since 2026-11-04, for token cost) |
| `.githooks/pre-push` | **Fires** on every push | Yes. Prints like pre-commit. Refuses a push to `main` or of a commit that is not `HEAD`. No tests (Paul, 2026-11-02): `npm run check:push` runs in `site-tests` |
| `.githooks/cs-site-route.sh` | **Fires** inside pre-commit and pre-push (a sourced router) | Yes, through them |
| `python3 -I scripts/worktree_deps.py --self-test` | **Waits**. Needs macOS and APFS (exit 3 elsewhere): no CI runner can run it, and this Mac runs no self-tests. Change it with care | No |

| Self-test | Runs in (each blocks as its job does) |
| --- | --- |
| `cs_site_lint.py --self-test`, `contract_test.py`, `hook_selftest.sh`, `merge_policy.py --self-test`, `export_public.py --self-test` (#552), `deploy_gate.sh --self-test` | [`content-gates`](site-ci.md); `deploy-gate` reruns the last before it moves `production` |
| `secret_scan.sh --self-test`, then `gitleaks_allow.py --self-test` and the allow-marker check (#774) | [`secret-scan`](site-ci.md); the first with the pinned gitleaks, before its scan |
| `site_changed.sh --self-test`, `ci_runner.sh --self-test` | [`site-tests`](site-ci.md), its change job |
| `tmp-leak-check.mjs --self-test` | [`site-tests`](site-ci.md), first in `npm run check:push`, when a `site-tests` input (such as `scripts/`) changed |

`npm run lint:selftest` chains four: the lint, the contract test, `hook_selftest.sh`, `tmp-leak-check.mjs`.

**Exit contract**: 0 clean, 1 blocking, 2 usage error, 3 could not check; 2 and 3 are infrastructure, never content. Hooks pass both with a note; CI warns on 3 and keeps 2 red ([`04_tools/README.md`](../../04_tools/README.md#exit-contract)).

Why `.claude/settings.json` reads as it does: [`site-settings.md`](site-settings.md).
