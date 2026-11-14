---
paths:
  - "data/team/**"
  - "data/communitas/**"
  - "site/src/components/art/keepers.ts"
  - "site/src/components/team/**"
  - "site/src/components/resourcus/**"
  - "site/src/components/communitas/**"
  - "site/src/components/hall/**"
  - "site/src/components/ui/SiteFooter.astro"
  - "site/src/pages/community/**"
  - "site/src/pages/team/**"
  - "site/src/pages/index.astro"
  - "site/src/pages/dispatches/**"
  - "site/public/llms.txt"
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
| Home page keeper teasers (`KeeperTeasers.astro`, used in `site/src/pages/index.astro`), the Team page (`site/src/pages/team/index.astro`), `/community/`, `/dispatches/` | `site/src/components/hall/KeeperTeasers.astro` and those pages |
| The model-readable site summary | `site/public/llms.txt` |
| Open Graph cards whose art is a keeper portrait; the card text must say "AI agent" | `art/og/cards.txt`, built by `scripts/og/build.mjs` |
| The `.ai-note` paragraph on every page | `site/src/components/ui/SiteFooter.astro` |
| The Communitas Slack app profile and its welcome DM | `workers/communitas/`, `data/communitas/` |
