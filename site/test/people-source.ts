// Which Team data this run builds on. scripts/people/overlay.mjs writes the
// marker when it puts fixtures or the R2 bundle in place; no marker means
// people.yaml is committed, as in this archive repo. Tests that name real
// people skip on fixtures, so the public repo's CI passes with fake names.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A path string, not a URL: under jsdom (the dom tests) the global URL is
// jsdom's, which node:fs does not accept, so the marker read as absent.
const MARKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../data/team/.people-source");

export const PEOPLE_SOURCE = existsSync(MARKER) ? readFileSync(MARKER, "utf8").trim() : "committed";
export const ON_FIXTURES = PEOPLE_SOURCE === "fixtures";
