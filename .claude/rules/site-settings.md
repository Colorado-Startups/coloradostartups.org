---
paths:
  - ".claude/settings.json"
---

# Site settings: why `.claude/settings.json` reads as it does

Moved from its `_README` key 2026-11-13: Claude Code rejects unknown settings keys. Which gate fires: [`site-gates.md`](site-gates.md).

| Rule | Why |
| --- | --- |
| No blanket `Bash(git commit:*)`; the allowed forms cannot carry `--no-verify` | a gate an agent can skip is not a gate |
| `git push origin main` denied, `git push origin` allowed | deny beats allow; `.githooks/pre-push` refuses `main` too |
| `wrangler d1` only as `npx wrangler d1 execute --local ...` | remote D1 writes need a person |
| Read denies on `.env` (`./**/.env`), `secrets/`, keys, `~/.ssh`, `~/.aws`, `.dev.vars` | credential files stay out of Claude's tools (code.claude.com/docs/en/permissions, read 2026-11-03) |
| `gh pr merge` allowed | the orchestrator merges with `--match-head-commit` and a literal SHA (decision 56); the bash guard refuses `--auto`, `--admin` |
| Deploys, secrets and remote D1 | the orchestrator only (decision 57) |

