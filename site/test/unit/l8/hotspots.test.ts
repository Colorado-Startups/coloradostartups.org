// Step W3a: hotspots on the region paintings. These read the real data files
// in data/regions/, so a bad point or label fails here before W3b draws it.
// Franchise names are the content gate's job (franchise-name in
// 04_tools/cs_site_rules.json scans data/**); this file checks the rest.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { HOTSPOT_KINDS, HotspotSchema, RegionSchema, type Hotspot } from "@cs/shared";

const DIR = new URL("../../../../data/regions/", import.meta.url);
const raw = readdirSync(DIR)
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => parse(readFileSync(new URL(f, DIR), "utf8")) as { id: string; hotspots?: unknown[] });
const regions = raw.map((r) => RegionSchema.parse(r));

const EDGE = 6; // percent of the painting kept clear on every side
const GAP = 12; // percentage points between any two hotspots
const BANNED = /\b(outpost|hq|hall)s?\b/i;
// An en dash, an em dash or an exclamation mark, built from char codes.
const DASH_OR_BANG = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}!]`);
const NON_PLACE = HOTSPOT_KINDS.filter((k) => k !== "place");
const OPENS: Record<Exclude<Hotspot["kind"], "place">, string> = {
  companies: "Who builds here",
  event: "Next event",
  resources: "Where to get help",
  seat: "The organizer seat",
};

const spots = (id: string) => regions.find((r) => r.id === id)?.hotspots ?? [];

describe("region hotspots: parsing", () => {
  it("keeps every hotspot through RegionSchema", () => {
    for (const r of raw) {
      const parsed = regions.find((p) => p.id === r.id);
      expect(r.hotspots?.length, `${r.id} has hotspots in its file`).toBeGreaterThan(0);
      expect(parsed?.hotspots).toEqual(r.hotspots);
    }
  });

  it("refuses a point off the painting, a long label and a stray key", () => {
    const ok = { x: 50, y: 50, kind: "event", label: "Next event" };
    expect(HotspotSchema.safeParse(ok).success).toBe(true);
    expect(HotspotSchema.safeParse({ ...ok, x: 101 }).success).toBe(false);
    expect(HotspotSchema.safeParse({ ...ok, y: -1 }).success).toBe(false);
    expect(HotspotSchema.safeParse({ ...ok, label: "One two three four five" }).success).toBe(false);
    expect(HotspotSchema.safeParse({ ...ok, href: "/x" }).success).toBe(false);
    expect(HotspotSchema.safeParse({ ...ok, label: "   " }).success).toBe(false);
    expect(HotspotSchema.safeParse({ ...ok, label: "" }).success).toBe(false);
  });

  it("pairs a landmark with place, and only with place", () => {
    const place = { x: 50, y: 50, kind: "place", label: "Pikes Peak" };
    expect(HotspotSchema.safeParse(place).success).toBe(false);
    expect(HotspotSchema.safeParse({ ...place, landmark: "Pikes Peak" }).success).toBe(true);
    // A fanciful label on a real landmark fails: the label is the name only.
    expect(HotspotSchema.safeParse({ ...place, label: "The Sky Forge", landmark: "Pikes Peak" }).success).toBe(false);
    expect(
      HotspotSchema.safeParse({ x: 50, y: 50, kind: "event", label: "Next event", landmark: "Pikes Peak" }).success,
    ).toBe(false);
  });
});

describe("region hotspots: data", () => {
  for (const r of regions) {
    describe(r.id, () => {
      const hs = spots(r.id);

      it("has 4 to 6 hotspots, each non-place kind once; a place is optional", () => {
        expect(hs.length).toBeGreaterThanOrEqual(4);
        expect(hs.length).toBeLessThanOrEqual(6);
        for (const k of NON_PLACE) expect(hs.filter((h) => h.kind === k), k).toHaveLength(1);
      });

      it("keeps every point off the outer 6% of the painting", () => {
        for (const h of hs) {
          for (const v of [h.x, h.y]) {
            expect(v, h.label).toBeGreaterThanOrEqual(EDGE);
            expect(v, h.label).toBeLessThanOrEqual(100 - EDGE);
          }
        }
      });

      it("spaces every pair at least 12 points apart", () => {
        for (const [i, a] of hs.entries()) {
          for (const b of hs.slice(i + 1)) {
            expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.label} to ${b.label}`).toBeGreaterThanOrEqual(GAP);
          }
        }
      });

      it("labels say what opens, in plain words", () => {
        for (const h of hs) {
          expect(h.label.split(/\s+/).length).toBeLessThanOrEqual(4);
          expect(h.label, h.label).not.toMatch(BANNED);
          expect(h.label, h.label).not.toMatch(DASH_OR_BANG);
          expect(h.label[0], h.label).toBe(h.label[0]!.toUpperCase());
          if (h.kind === "place") expect(h.label).toBe(h.landmark);
          else expect(h.label).toBe(OPENS[h.kind]);
        }
      });

      it("never uses the region's own fantasy name in a place label", () => {
        for (const h of hs.filter((x) => x.kind === "place")) {
          expect(h.label).not.toContain(r.name);
        }
      });
    });
  }
});
