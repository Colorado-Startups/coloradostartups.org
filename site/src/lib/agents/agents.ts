// The AI agents on /agents/ (step A6a), in two groups. No agent's name, role
// or disclosure line is typed here; each comes from its source:
//
//   On this site          the keepers in data/team/dwarves.yaml, in file order:
//                         name, title, role (the one line) and disclosure
//   In your own AI tool   brand.json `characters` with agents_page: true
//                         (data/brand/brand.json, pulled at the brand.lock.json
//                         tag by scripts/brand/pull.mjs): name, card, repo and
//                         disclosure
//
// This file adds only what neither source holds: where each keeper works on
// this site, and each project's one line and install paths, from its own
// README on GitHub. A shown character with no README entry here, or a keeper
// with no place on the site, stops the build, so a flag flipped in a brand
// release cannot ship a half-filled card.
//
// test/unit/agents/agents.test.ts checks this file against the sources, and
// test/dom/agents.test.ts checks the built page.
import { type Dwarf, DwarfSchema } from "@cs/shared";
import { parse } from "yaml";
import { z } from "zod";

import BRAND from "../../../../data/brand/brand.json";
import dwarvesRaw from "../../../../data/team/dwarves.yaml?raw";
import { brandArt } from "../../components/art/art-assets";
import { portraitAlt, type KeeperId } from "../../components/art/keepers";

/**
 * The apps an install path may name: Claude's (claude.ai, Claude Desktop,
 * Claude Code) and OpenCode, the ones 01_doctrine/ai_recommend.yaml lets the
 * site offer. test/unit/agents/agents.test.ts reads that file to hold this list to it.
 */
export const INSTALL_APPS = ["Claude Code", "Claude Desktop", "claude.ai", "OpenCode"] as const;
export type InstallApp = (typeof INSTALL_APPS)[number];

/** One way to install a project, as its README writes it. */
export interface InstallPath {
  app: InstallApp;
  /** What to run, word for word from the README. */
  commands: readonly string[];
  /** The README section with the full steps, on the project's own repo. */
  steps: string;
}

/** A keeper: an AI agent that runs on this site. */
export interface SiteAgent {
  group: "site";
  id: KeeperId;
  name: string;
  /** The one plain line: the keeper's role in dwarves.yaml. */
  what: string;
  /** Where it works on this site. */
  where: { href: string; label: string };
  disclosure: string;
  alt: string;
}

/** An open-source AI agent project that runs in your own AI tool. */
export interface ProjectAgent {
  group: "project";
  id: string;
  name: string;
  /** The one plain line, from the project's README. */
  what: string;
  /** A short line from the repo: its platform and that it is not affiliated. */
  note: string;
  repo: string;
  repoUrl: string;
  /** Art key for the brand's social card, e.g. "brand/claudius". */
  card: string;
  cardAlt: string;
  install: readonly InstallPath[];
  disclosure: string;
}

/** A brand.json character, as the brand release ships it. */
const CharacterSchema = z.object({
  name: z.string().min(1),
  card: z.string().regex(/^social\/[a-z0-9-]+\.(?:jpg|png)$/),
  what: z.string().min(1),
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  agents_page: z.boolean(),
  disclosure: z.string().min(10),
});
export type Character = z.infer<typeof CharacterSchema>;

export const KEEPERS: readonly Dwarf[] = (parse(dwarvesRaw) as unknown[]).map((d) => DwarfSchema.parse(d));
// Keys the page does not read, such as agents_page_note, are dropped.
const CHARACTERS: readonly Character[] = z.array(CharacterSchema).parse(BRAND.characters);

/**
 * Where each keeper works on this site, read from the pages (2026-11-16):
 * Communitas's welcome desk is on /community/ (WelcomeDesk), Resourcus answers
 * on /ask/ (ResourcusPanel; Startup Resources shows the same panel), and
 * Publicus keeps /dispatches/.
 */
export const KEEPER_HOMES: Readonly<Record<KeeperId, { href: string; label: string }>> = {
  communitas: { href: "/community/", label: "Visit the welcome desk" },
  resourcus: { href: "/ask/", label: "Ask Resourcus" },
  publicus: { href: "/dispatches/", label: "Read the dispatches" },
};

/**
 * Each project's line and install paths, keyed by repo, from its README on
 * GitHub (gh api repos/<repo>/readme, read 2026-11-16; Linken's entry re-read
 * 2026-11-20, after its rename from Link). Only Claude and OpenCode paths are
 * kept (01_doctrine/ai_recommend.yaml). Legallas has no entry: its repo is
 * private, and the brand sets agents_page: false.
 *
 * A key is the brand's `repo` for that character, so Linken's still reads
 * Colorado-Startups/link until a brand release (brand.lock.json) says
 * Colorado-Startups/linken. Then rename its key and its `steps` URL to match;
 * the tests tie both to the brand's value.
 */
export const PROJECT_README: Readonly<Record<string, { what: string; note: string; install: readonly InstallPath[] }>> = {
  "Colorado-Startups/claudius": {
    // README line 3, after "The Claude pack for Git Crafter:". Note: the repo's own description.
    what: "Claude Code templates, Quality tabs and Process maps for a GitHub repo that agents drive from the Claude desktop app.",
    note: "Not an Anthropic product.",
    install: [
      {
        app: "Claude Code",
        // README "What it is", the Plugin row.
        commands: ["claude plugin marketplace add Colorado-Startups/claudius", "claude plugin install claudius@claudius"],
        steps: "https://github.com/Colorado-Startups/claudius#what-it-is",
      },
    ],
  },
  "Colorado-Startups/link": {
    // README's "Clean up" row, then its second tagline sentence. Note: the repo's "macOS" and the README's last line.
    what: "Keeps the contacts who matter, removes clear spam, paced. Nothing posts until you click.",
    note: "macOS only. Not affiliated with LinkedIn or Anthropic.",
    install: [
      {
        app: "Claude Code",
        // README "Install", step 1.
        commands: ["/plugin install linken --marketplace Colorado-Startups/linken"],
        // Stays on the brand's repo value (a test needs steps to start with repoUrl); GitHub redirects link to linken.
        steps: "https://github.com/Colorado-Startups/link#install",
      },
    ],
  },
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const cardKey = (card: string) => `brand/${card.replace(/^.*\//, "").replace(/\.[a-z]+$/, "")}`;

/** Alt text for a project's card: its name, that it is an AI agent, and what the card shows. */
export function cardAlt(c: Pick<Character, "name" | "what">): string {
  return `${c.name}, an open-source AI agent project, painted as ${lowerFirst(c.what.trim())}.`;
}

/** The keepers, in file order, each with its place on the site. Throws for a keeper with none. */
export function siteAgents(
  keepers: readonly Dwarf[] = KEEPERS,
  homes: Readonly<Record<string, { href: string; label: string }>> = KEEPER_HOMES,
): SiteAgent[] {
  return keepers.map((k) => {
    const where = homes[k.id];
    if (!where) throw new Error(`/agents/: keeper "${k.id}" has no place on the site in KEEPER_HOMES (lib/agents/agents.ts)`);
    return { group: "site", id: k.id, name: k.name, what: k.role, where, disclosure: k.disclosure, alt: portraitAlt(k.id, k.name, k.title) };
  });
}

/**
 * The brand's characters with agents_page: true, in brand order. Throws for a
 * shown character with no README entry or no pulled card, so a flag that flips
 * in a brand release fails the build until this file and the page catch up.
 */
export function projectAgents(
  characters: readonly Character[] = CHARACTERS,
  readme: typeof PROJECT_README = PROJECT_README,
  hasArt: (key: string) => boolean = (key) => brandArt(key) !== undefined,
): ProjectAgent[] {
  return characters
    .filter((c) => c.agents_page)
    .map((c) => {
      const extra = readme[c.repo];
      if (!extra) throw new Error(`/agents/: ${c.name} is on the page (agents_page: true) but PROJECT_README has no entry for ${c.repo}`);
      const card = cardKey(c.card);
      if (!hasArt(card)) throw new Error(`/agents/: ${c.name}'s card ${c.card} is not pulled (brand.lock.json)`);
      return {
        group: "project",
        id: c.name.toLowerCase(),
        name: c.name,
        what: extra.what,
        note: extra.note,
        repo: c.repo,
        repoUrl: `https://github.com/${c.repo}`,
        card,
        cardAlt: cardAlt(c),
        install: extra.install,
        disclosure: c.disclosure,
      };
    });
}

export const SITE_AGENTS: readonly SiteAgent[] = siteAgents();
export const PROJECT_AGENTS: readonly ProjectAgent[] = projectAgents();
