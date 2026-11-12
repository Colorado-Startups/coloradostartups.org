// Which Team data this run builds on. scripts/people/overlay.mjs writes the
// marker when it puts fixtures or the R2 bundle in place; no marker means
// people.yaml is committed, as in this archive repo. Tests that name real
// people skip on fixtures, so the public repo's CI passes with fake names.
import { existsSync, readFileSync } from "node:fs";

const MARKER = new URL("../../data/team/.people-source", import.meta.url);

export const PEOPLE_SOURCE = existsSync(MARKER) ? readFileSync(MARKER, "utf8").trim() : "committed";
export const ON_FIXTURES = PEOPLE_SOURCE === "fixtures";
