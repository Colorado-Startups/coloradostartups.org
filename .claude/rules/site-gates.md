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

Moved out of `CLAUDE.md` on 2026-11-03, so it loads only when Claude opens a gate file (code.claude.com/docs/en/memory, path-scoped rules). `.claude/settings.json` is the authority on the wiring, not a hook's header comment. `04_tools/contract_test.py` (C5) checks this table against it.

No gate runs a test, build or render on this Mac (Paul, 2026-11-02). Here the git hooks run the content lint, the secret scan and `contract_test.py`, the one local self-check (about 0.17 s, the orchestrator's timing, 2026-11-02). Every suite and every other self-test runs in CI, except the last row below. Which workflow fires and which blocks a merge: [`site-ci.md`](site-ci.md).

| Gate | When | Blocking |
| --- | --- | --- |
| `.claude/hooks/cs-site-content-guard.sh` | **Fires** on every Write and Edit | No. Exit 2 on a FAIL shows Claude the findings; the edit is already saved |
| `.claude/hooks/cs-site-session-start.sh` | **Fires** at session start | No. Prints only what a session should act on. Sets the repo's `core.hooksPath=.githooks` unless a repo or worktree value exists, even over a global or system one, then seeds a new worktree's `node_modules` (`scripts/worktree_deps.py`) |
| `.githooks/pre-commit` | **Fires** on every commit | Yes. Prints only what blocks or could not run; CI's `content-gates` shows the warnings (2026-11-03; no WARN count since 2026-11-04, hook token cost) |
| `.githooks/pre-push` | **Fires** on every push | Yes. Prints like pre-commit. Refuses a push to `main` and a pushed commit that is not `HEAD`. Runs no tests (Paul, 2026-11-02): `npm run check:push` runs in `site-tests` |
| `.githooks/cs-site-route.sh` | **Fires** inside pre-commit and pre-push (a sourced router) | Yes, through them |
| `python3 -I scripts/worktree_deps.py --self-test` | **Waits**. It needs macOS and APFS (exit 3 elsewhere), so no CI runner can run it, and this Mac runs no self-tests. Change that script with care | No |

| Self-test | Runs in (each blocks as its job does) |
| --- | --- |
| `cs_site_lint.py --self-test`, `contract_test.py`, `hook_selftest.sh`, `merge_policy.py --self-test`, `export_public.py --self-test` (#552), `deploy_gate.sh --self-test` | [`content-gates`](site-ci.md); `deploy-gate` reruns the last before it moves `production` |
| `secret_scan.sh --self-test`, then `gitleaks_allow.py --self-test` and the allow-marker check (#774) | [`secret-scan`](site-ci.md); the first with the pinned gitleaks, before its scan |
| `site_changed.sh --self-test`, `ci_runner.sh --self-test` | [`site-tests`](site-ci.md), its change job |
| `tmp-leak-check.mjs --self-test` | [`site-tests`](site-ci.md), first inside `npm run check:push`, when a `site-tests` input changed (`scripts/` is one) |

`npm run lint:selftest` chains four of them: the lint, the contract test, `hook_selftest.sh` and `tmp-leak-check.mjs`.

**Exit contract** for every checker: 0 clean, 1 blocking finding, 2 usage error, 3 could not check. Exit 2 or 3 is an infrastructure condition, never a content violation: could not verify is not the same as verified and red. Git hooks pass 2 and 3 with a note; CI passes 3 with a warning and keeps 2 red (`04_tools/README.md` says why).

## Why `.claude/settings.json` reads as it does

Moved from its old `_README` key on 2026-11-13: Claude Code rejects unknown settings keys.

| Rule | Why |
| --- | --- |
| No blanket `Bash(git commit:*)`; the allowed forms cannot carry `--no-verify` | a gate an agent can skip is not a gate |
| `git push origin main` denied though `git push origin` is allowed | deny beats allow; `.githooks/pre-push` refuses `main` too |
| `wrangler d1` only as `npx wrangler d1 execute --local ...` | remote D1 writes need a person |
| Read denies on `.env` (`./**/.env`), `secrets/`, keys, `~/.ssh`, `~/.aws`, `.dev.vars` | credential files stay out of Claude's tools (code.claude.com/docs/en/permissions, read 2026-11-03) |
| `gh pr merge` allowed | the orchestrator merges with `--match-head-commit` and a literal SHA (decision 56); the bash guard refuses `--auto` and `--admin` |
| Deploys, secrets and remote D1 | the orchestrator only (decision 57) |

