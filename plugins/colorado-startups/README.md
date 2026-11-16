# The colorado-startups plugin

Colorado Startups inside Claude Code: startup resources, events, regions and Leaderboard companies for founders building in Colorado.

## Install

Run these two commands in your shell:

```sh
claude plugin marketplace add Colorado-Startups/coloradostartups.org
claude plugin install colorado-startups@colorado-startups
```

Inside a session, `/plugin marketplace add Colorado-Startups/coloradostartups.org` does the same as the first.

## What it adds

| Part | What it does | File |
| --- | --- | --- |
| MCP server `coloradostartups` | Connects to https://coloradostartups.org/mcp. Read-only, and needs no key | [`.mcp.json`](.mcp.json) |
| Skill `colorado-startups` | Tells Claude which tool to call for which founder question, the limits and how to cite | [`skills/colorado-startups/SKILL.md`](skills/colorado-startups/SKILL.md) |

## For claude.ai

| Where | What |
| --- | --- |
| Download | https://coloradostartups.org/downloads/colorado-startups-skill.zip, the skill folder as a zip |
| Upload | In claude.ai, add it as a skill |
| Built by | [`scripts/skill-zip/build.mjs`](../../scripts/skill-zip/build.mjs), in the site's prebuild |

The skill needs the MCP server, so add https://coloradostartups.org/mcp as a connector too.

## License

| What | License |
| --- | --- |
| This plugin | CC0 1.0, like the rest of the repo ([`LICENSE`](../../LICENSE)) |
| The data the server returns | CC BY 4.0: credit Colorado Startups and link https://coloradostartups.org/data/ |
