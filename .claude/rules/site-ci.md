---
paths:
  - ".github/**"
  - "04_tools/ci_runner.sh"
  - "04_tools/deploy_gate.sh"
---

# Site CI: which workflows fire and which block

Split from [`site-gates.md`](site-gates.md) on 2026-11-04; that file keeps the local gates, the self-tests and the exit contract. The workflow files in `.github/workflows/` are the authority.

| Workflow | When | Blocks a merge |
| --- | --- | --- |
| `site-tests` | **Fires** on pull request and push to `main`. One test job runs `npm run check:push`, the build, the built-site lint and the dom tests, between a change job and a verdict job | Yes |
| `e2e` | **Fires** on pull request only. Playwright journeys and axe checks in `site/e2e/`, in 2 shards when the static site's inputs or the workflow changed (else skipped), end in one check | Yes |
| DCO app (`.github/dco.yml`) | **Fires** on pull request. A commit by an org member that GitHub verifies as signed needs no `Signed-off-by`; every other commit does (decision 82) | Yes |
| `content-gates`, `secret-scan` | **Fire** on pull request and push to `main` | No |
| `deploy-gate` | **Fires** when `site-tests` or `secret-scan` finishes green on a push to `main`, and every 15 minutes where the variable `DEPLOY_GATE_SCHEDULE` is 1. `04_tools/deploy_gate.sh` (vendored from Git Crafter) fast-forwards `production`, never forced, once every gate that ran passed. A range with an outside commit waits 30 minutes from its push and for the staging build check first. It alone writes `production`; red means `production` did not move | No |
| `pages` | **Fires** on push to `main`, daily at 11:23 UTC, on dispatch, and on a pull request touching a doc, `quality/` or the workflow. Builds the public Quality, Speed and Consumption page and the Process page through Git Crafter's `actions/pages` at a pinned SHA (v7.0.0, Claudius pack), leak-scans them with `04_tools/export_scan.py`, and on `main` deploys to GitHub Pages. A pull request fails on `docs.unmapped` or a bad override in `quality/targets/` (exit 2) | No |
| `visual-check` | **Waits** for `gh workflow run visual-check.yml -f ref=<sha> -f paths=<routes> -f widths=<px>`; uploads full-page screenshots as the artifact `visual`. A pull request changing it, `site/playwright.visual.config.ts` or `site/test/visual/` runs `/` at 375 px | No |
| `cloud-test`, a caller of the shared workflow in Colorado-Startups/.github | **Waits** for `gh workflow run cloud-test.yml --ref <branch> -f script=<name>`, a name from `.github/cloud-test.json`, on a hosted runner. A pull request changing the caller or the allowlist runs `test:unit` in 2 shards | No |
| `ai-visibility` | **Waits** for a dispatch from `main`, its one paid live run (only the orchestrator dispatches it, after Paul sets the secret). A pull request changing it or `evals/ai-visibility/` runs the plan alone, which sends nothing | No |
| `dependency-age`, `export-dry-run` | **Fire** on a pull request changing `package-lock.json` or a `package.json`, or `04_tools/export_*`, the lint or `.gitleaksignore`; `export-dry-run` also on dispatch | No |

The ruleset "main: required checks" requires `site-tests`, `e2e` and DCO on `main` (`gh api repos/{repo}/rulesets/27158066`, created 2026-11-12). The orchestrator still merges only when every check passed (`delegation.md`, Who merges). The `site-tests` and `e2e` test jobs take their runner from `CI_RUNNER` through `04_tools/ci_runner.sh`.
