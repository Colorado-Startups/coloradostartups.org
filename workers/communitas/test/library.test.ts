import { ThreadOpenerSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { LIBRARY, LibrarySchema } from "../src/library";
import raw from "../src/generated/library.json";

// The library is everything Communitas may say on its own: the welcome DM, the
// help text, the answer frame and the weekly openers. These tests hold it to
// the lane contract. The YAML-to-JSON parity check lives in
// site/test/unit/l5/communitas-library.test.ts, because only Node can read the
// YAML sources.

const allCopy = (): string[] => [
  ...LIBRARY.threads.flatMap((t) => [t.title, t.body]),
  ...LIBRARY.slack.welcome.lines,
  ...LIBRARY.slack.welcome.links.map((l) => l.label),
  ...LIBRARY.slack.help.lines,
  ...LIBRARY.slack.help.links.map((l) => l.label),
  ...Object.values(LIBRARY.slack.answer).flatMap((v) => (typeof v === "string" ? [v] : Object.values(v))),
];

describe("the Communitas library", () => {
  it("parses against its schema", () => {
    expect(LibrarySchema.safeParse(raw).success).toBe(true);
  });

  it("holds openers that match the shared ThreadOpener contract", () => {
    for (const t of LIBRARY.threads) expect(ThreadOpenerSchema.safeParse(t).success, t.id).toBe(true);
  });

  it("has unique opener ids", () => {
    const ids = LIBRARY.threads.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has at least one opener for each of Monday, Wednesday and Friday", () => {
    for (const day of ["mon", "wed", "fri"] as const) {
      expect(LIBRARY.threads.some((t) => t.day === day), day).toBe(true);
    }
  });

  it("asks exactly one question in every opener", () => {
    for (const t of LIBRARY.threads) expect((t.body.match(/\?/g) ?? []).length, t.id).toBe(1);
  });

  it("never mentions or pings anyone in its own copy", () => {
    for (const line of allCopy()) {
      expect(line, line).not.toMatch(/<[!@#]|@(?:here|channel|everyone)\b/i);
    }
  });

  it("links only to paths on the site, never to another host", () => {
    const paths = [
      ...LIBRARY.slack.welcome.links.map((l) => l.path),
      ...LIBRARY.slack.help.links.map((l) => l.path),
      LIBRARY.slack.answer.canvas_path,
    ];
    for (const p of paths) expect(p, p).toMatch(/^\/[a-z0-9/-]*$/);
  });

  it("carries both AI disclosures from data/team/dwarves.yaml", () => {
    expect(LIBRARY.disclosure.communitas).toMatch(/^Communitas is an AI agent run by Colorado Startups\./);
    expect(LIBRARY.disclosure.resourcus).toMatch(/^Resourcus is an AI agent run by Colorado Startups/);
  });

  it("has a fallback line for every non-ok Resourcus reason", () => {
    for (const reason of ["budget", "rate-limit", "error", "unsafe", "no-match"] as const) {
      expect(LIBRARY.slack.answer.fallback[reason].length, reason).toBeGreaterThan(10);
    }
  });
});
