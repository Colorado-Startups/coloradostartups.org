// The sources /agents/ copies from, read straight off disk so the tests never
// trust lib/agents/agents.ts to read them: data/team/dwarves.yaml for the
// keepers, and the pulled data/brand/brand.json `characters` for the
// open-source AI agent projects. test/unit/agents/ and test/dom/agents.test.ts
// share these, and disclosureProblems() below, so both hold the page to the
// same sources.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

// A path string, not a URL: under jsdom the global URL is jsdom's, which node:fs refuses.
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface SourceKeeper {
  id: string;
  name: string;
  disclosure: string;
}
export interface SourceCharacter {
  name: string;
  repo: string;
  card: string;
  what: string;
  agents_page: boolean;
  disclosure: string;
}

export const SOURCE_KEEPERS: readonly SourceKeeper[] = YAML.parse(
  readFileSync(path.join(REPO, "data/team/dwarves.yaml"), "utf8"),
) as SourceKeeper[];

export const SOURCE_CHARACTERS: readonly SourceCharacter[] = (
  JSON.parse(readFileSync(path.join(REPO, "data/brand/brand.json"), "utf8")) as { characters: SourceCharacter[] }
).characters;

/** The characters the brand puts on /agents/. */
export const SHOWN_CHARACTERS = SOURCE_CHARACTERS.filter((c) => c.agents_page);

/**
 * Each disclosure that is not its source's, character for character, as
 * "<name>: shows "<shown>", source says "<want>"". Also flags a source agent
 * the page leaves out and an agent the sources do not name. [] when every
 * line matches.
 */
export function disclosureProblems(
  shown: readonly { name: string; disclosure: string | null }[],
  want: readonly { name: string; disclosure: string }[],
): string[] {
  const problems: string[] = [];
  for (const w of want) {
    const s = shown.find((x) => x.name === w.name);
    if (!s) problems.push(`${w.name}: not shown`);
    else if (s.disclosure !== w.disclosure) problems.push(`${w.name}: shows "${s.disclosure}", source says "${w.disclosure}"`);
  }
  for (const s of shown) if (!want.some((w) => w.name === s.name)) problems.push(`${s.name}: not in the sources`);
  return problems;
}
