---
paths:
  - "data/team/**"
  - "data/communitas/**"
  - "site/src/components/art/keepers.ts"
  - "site/src/components/team/**"
  - "site/src/components/resourcus/**"
  - "site/src/components/communitas/**"
  - "site/src/components/hall/**"
  - "site/src/components/home/KeeperStrip.astro"
  - "site/src/components/ui/SiteFooter.astro"
  - "site/src/pages/community/**"
  - "site/src/pages/team/**"
  - "site/src/pages/index.astro"
  - "site/src/pages/dispatches/**"
  - "site/src/pages/agents.astro"
  - "site/src/lib/agents/**"
  - "data/brand/**"
  - "site/src/pages/llms.txt.ts"
  - "art/og/**"
  - "scripts/og/**"
  - "workers/communitas/**"
---

# AI disclosure surfaces

Canonical copy, moved out of `CLAUDE.md` on 2026-11-03 so it loads only when Claude opens a surface.

Every keeper (the dwarves and the gnome) is disclosed as an AI agent wherever it appears, in words or in a picture. A person checks it in PR review. The disclosure surfaces:

| Surface | Where |
| --- | --- |
| `disclosure` field (the schema requires it), rendered on the Team page (`KeeperCard`), in `ResourcusPanel` and in `WelcomeDesk` | `data/team/dwarves.yaml` |
| Keeper portraits: alt text from `portraitAlt()`, which says "AI agent" | `site/src/components/art/keepers.ts` |
| The home page's keeper strip (`KeeperStrip.astro`, used in `site/src/pages/index.astro`), the `/ask/` line on Resourcus, the Team page (`site/src/pages/team/index.astro`), `/community/`, `/dispatches/`, `/agents/` | `site/src/components/home/KeeperStrip.astro` and those pages |
| `/agents/`: each keeper's disclosure from `dwarves.yaml`, and each open-source AI agent project's from the brand's `characters` (only those with `agents_page: true`), word for word beside it; every picture's alt says "AI agent" | `site/src/lib/agents/agents.ts`, `data/brand/brand.json` (pulled by `scripts/brand/pull.mjs`) |
| The model-readable site summary | `site/src/pages/llms.txt.ts` |
| Open Graph cards whose art is a keeper portrait; the card text must say "AI agent" | `art/og/cards.txt`, built by `scripts/og/build.mjs` |
| The `.ai-note` paragraph on every page | `site/src/components/ui/SiteFooter.astro` |
| The Communitas Slack app profile and its welcome DM | `workers/communitas/`, `data/communitas/` |
