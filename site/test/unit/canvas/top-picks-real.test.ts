// L1b: topPicks() on the real active records, the picks Startup Resources
// opens on. Prints the picks for the PR body and pins the rules the page
// relies on: at most 3 a stage, each an active record, at most one
// commercial pick a stage, and labels that never rank or endorse.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { ResourceSchema, STAGES, toCard } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { cityLabel, PICK_REASON_LABELS, showAllText, TYPE_LABELS } from "../../../src/components/canvas/labels";
import { isCommercial, topPicks } from "../../../src/components/canvas/top-picks";

const DATA = path.resolve(import.meta.dirname, "..", "..", "..", "..", "data", "resources");
const active = readdirSync(DATA, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => readdirSync(path.join(DATA, d.name)).map((f) => parse(readFileSync(path.join(DATA, d.name, f), "utf8"))))
  .filter((r) => r.status === "active")
  .map((r) => toCard(ResourceSchema.parse(r)));

const BANNED = /\b(best|top|recommended)\b/i;

describe("topPicks on the real records", () => {
  const result = topPicks(active);
  const picks = result.flatMap((s) => s.picks);

  it("gives at most 3 picks a stage, 12 in all, each an active record", () => {
    expect(result.map((s) => s.stage)).toEqual([...STAGES]);
    for (const s of result) expect(s.picks.length).toBeLessThanOrEqual(3);
    expect(picks.length).toBeLessThanOrEqual(12);
    const ids = new Set(active.map((c) => c.id));
    for (const p of picks) expect(ids.has(p.card.id)).toBe(true);
    const lines = result.map(
      (s) =>
        `${s.stage}: ${s.picks
          .map((p) => `${p.card.name} (${TYPE_LABELS[p.card.type]}, ${cityLabel(p.card.city)}; ${PICK_REASON_LABELS[p.reason]})`)
          .join(" | ")}`,
    );
    console.log(`${active.length} active\n${lines.join("\n")}`);
  });

  it("holds one commercial pick a stage at most", () => {
    for (const s of result) expect(s.picks.filter((p) => isCommercial(p.card)).length).toBeLessThanOrEqual(1);
  });

  // PR #89 review: a service provider typed "accelerator" or "event" read as
  // a vendor endorsement. Any service-providers record is commercial now.
  it("picks no commercial card while a non-commercial card at that stage was left out", () => {
    for (const s of result) {
      const picked = new Set(s.picks.map((p) => p.card.id));
      const leftOut = active.filter((c) => c.stage === s.stage && !isCommercial(c) && !picked.has(c.id));
      const commercial = s.picks.filter((p) => isCommercial(p.card)).map((p) => p.card.name);
      if (leftOut.length > 0) expect(commercial, s.stage).toEqual([]);
      // A stage with no non-commercial card shows one commercial pick at most.
      else expect(commercial.length, s.stage).toBeLessThanOrEqual(1);
    }
  });

  it("labels each reason and the control without ranking words", () => {
    for (const label of Object.values(PICK_REASON_LABELS)) expect(label).not.toMatch(BANNED);
    expect(showAllText(active.length)).toBe(`Show all ${active.length} resources`);
  });
});
