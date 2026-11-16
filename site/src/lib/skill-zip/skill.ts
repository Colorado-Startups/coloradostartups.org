// The colorado-startups skill as a zip for claude.ai (step A6b). claude.ai
// wants the skill folder at the zip's root, named for the skill, with the
// skill file inside it (support.claude.com, "How to create custom skills",
// read 2026-11-16). Vite reads the folder at build time, so the zip always
// matches plugins/colorado-startups/skills/colorado-startups/.
import { Buffer } from "node:buffer";

import { zip } from "./zip";

export const SKILL_NAME = "colorado-startups";
export const SKILL_ZIP_PATH = `/downloads/${SKILL_NAME}-skill.zip`;

// Every file in the skill folder, as text. Dotfiles are left out.
const FILES = import.meta.glob<string>("../../../../plugins/colorado-startups/skills/colorado-startups/**/*", {
  query: "?raw",
  import: "default",
  eager: true,
});
const PREFIX = "../../../../plugins/colorado-startups/skills/colorado-startups/";

const bySkillFirst = (a: string, b: string) =>
  a === "SKILL.md" ? -1 : b === "SKILL.md" ? 1 : a < b ? -1 : a > b ? 1 : 0;

/** The skill's files as zip entries, sorted: colorado-startups/SKILL.md first. */
export function skillFiles(): { name: string; text: string }[] {
  return Object.entries(FILES)
    .map(([key, text]) => ({ rel: key.slice(PREFIX.length), text }))
    .sort((a, b) => bySkillFirst(a.rel, b.rel))
    .map(({ rel, text }) => ({ name: `${SKILL_NAME}/${rel}`, text }));
}

/** The skill folder as zip bytes. */
export function skillZip(): Buffer {
  return zip(skillFiles().map(({ name, text }) => ({ name, data: Buffer.from(text, "utf8") })));
}
