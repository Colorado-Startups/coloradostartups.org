// L1b: topPicks() on the real active records, the picks Startup Resources
// opens on. Prints the picks for the PR body and pins the rules the page
// relies on: at most 3 a stage, each an active record, no commercial
// pick, and labels that never rank or endorse.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { ResourceSchema, STAGES, toCard } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { cityLabel, PICK_REASON_LABELS, showAllText, TYPE_LABELS } from "../../../src/components/canvas/labels";
import { isCommercial, PICKS_PER_STAGE, substageCounts, topPicks } from "../../../src/components/canvas/top-picks";

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

  it("gives at most 3 picks a stage, each an active record", () => {
    expect(result.map((s) => s.stage)).toEqual([...STAGES]);
    for (const s of result) expect(s.picks.length).toBeLessThanOrEqual(PICKS_PER_STAGE);
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

  it("holds no more than one commercial pick a stage (zero is pinned below)", () => {
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
    }
  });

  // PR #89 review: every Growth record is an investor or a service provider,
  // so Growth gets no pick; the page shows a browse row with these counts.
  it("gives Growth no pick, and browse counts that equal the data", () => {
    const growth = result.find((s) => s.stage === "growth")!;
    expect(growth.picks).toEqual([]);
    const counts = substageCounts(active, "growth");
    expect(counts.length).toBeGreaterThan(0);
    for (const { substage, count } of counts) {
      expect(count, substage).toBe(active.filter((c) => c.stage === "growth" && c.substage === substage).length);
    }
    expect(counts.reduce((n, c) => n + c.count, 0)).toBe(active.filter((c) => c.stage === "growth").length);
  });

  it("never picks a commercial card", () => {
    for (const p of picks) expect(isCommercial(p.card), p.card.name).toBe(false);
  });

  it("labels each reason and the control without ranking words", () => {
    for (const label of Object.values(PICK_REASON_LABELS)) expect(label).not.toMatch(BANNED);
    expect(showAllText(active.length)).toBe(`Show all ${active.length} resources`);
  });
});
