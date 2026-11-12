// One definition of the llms.txt keeper check (hard constraint 10), with two
// call sites: test/unit/l29/keeper-disclosure.test.ts reads site/public/llms.txt
// and runs the self-test, and test/dom/l13/info-pages.test.ts reads the built
// dist/llms.txt. Every sentence that names a keeper must say "AI agent".
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const DWARVES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../data/team/dwarves.yaml");

/** The keepers' names, read from data/team/dwarves.yaml so a new keeper is checked without a code change. */
export function keeperNames(file: string = DWARVES): string[] {
  return (parse(readFileSync(file, "utf8")) as { name: string }[]).map((k) => k.name);
}

/** Splits text into sentences at a period, exclamation mark or question mark followed by whitespace. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The sentences that name a keeper but do not say "AI agent". An empty list
 * means every mention is disclosed. Pure: no file access, so the real file
 * and the self-test samples run through the same code.
 */
export function undisclosedKeeperSentences(text: string, keepers: readonly string[]): string[] {
  const names = keepers.map((k) => new RegExp(`\\b${escapeRe(k)}\\b`));
  return sentences(text).filter((s) => names.some((re) => re.test(s)) && !s.includes("AI agent"));
}
