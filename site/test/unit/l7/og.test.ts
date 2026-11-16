// L7: pure helpers behind the OG card generator (scripts/og/).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import YAML from "yaml";

import {
  DISCLOSURE,
  DISCLOSURE_CAPTION,
  coverCrop,
  disclosureCaption,
  disclosureProblem,
  isKeeperArt,
  parseCards,
  parseFocus,
  portraitPlacement,
  textLayout,
  wrapText,
  xmlEscape,
} from "../../../../scripts/og/lib.mjs";

const ROOT = path.join(__dirname, "../../../..");
const CARDS = readFileSync(path.join(ROOT, "art/og/cards.txt"), "utf8");
const REGION_DIR = path.join(ROOT, "data/regions");
const REGIONS = Object.fromEntries(
  readdirSync(REGION_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => {
      const r = YAML.parse(readFileSync(path.join(REGION_DIR, f), "utf8"));
      return [r.id, r];
    }),
);
// BaseLayout.astro links /og/<id>.jpg; these are the ids the orchestrator asked L7 for.
const REQUIRED = [
  "home",
  "community",
  "leaderboard",
  "ecosystem-canvas",
  "regions",
  "photon-mountain",
  "space-peak",
  "fusion-canyon",
  "team",
  // /agents/ (step A6a): titled "AI agents", on the Communitas portrait.
  "agents",
  "get-involved",
  "founders",
  "dispatches",
  "connect",
  "default",
];

describe("cards.txt", () => {
  it("has a card for every required route", () => {
    const ids = parseCards(CARDS, REGIONS).map((c: { id: string }) => c.id);
    expect(ids.sort()).toEqual([...REQUIRED].sort());
  });

  it("takes each region card's name and art from data/regions, L8's single source", () => {
    const cards = parseCards(CARDS, REGIONS);
    for (const id of ["photon-mountain", "space-peak", "fusion-canyon"]) {
      const card = cards.find((c: { id: string }) => c.id === id);
      expect(card.title).toBe(REGIONS[id].name);
      expect(card.art).toBe(REGIONS[id].art);
    }
  });

  // Brand decision 46: every card shows only its name.
  it("carries no subtitle on any card, and rejects one", () => {
    for (const card of parseCards(CARDS, REGIONS)) expect(card.subtitle, card.id).toBeUndefined();
    expect(() => parseCards("id: a\ntitle: A\nsubtitle: a tagline")).toThrow(/show only their name/);
  });

  it("rejects a region card whose region has no data file", () => {
    expect(() => parseCards("id: x\nregion: nowhere", REGIONS)).toThrow(/no data\/regions file/);
  });

  it("rejects a card without a title", () => {
    expect(() => parseCards("id: home\nart: brand/golden")).toThrow(/missing "title"/);
  });

  it("rejects duplicate ids", () => {
    expect(() => parseCards("id: a\ntitle: A\n\nid: a\ntitle: B")).toThrow(/duplicate/);
  });
});

describe("wrapText", () => {
  const byChars = (s: string) => s.length * 10;

  it("wraps greedily at the width", () => {
    expect(wrapText("one two three four", 90, byChars)).toEqual(["one two", "three", "four"]);
  });

  it("cuts to maxLines and ends with an ellipsis", () => {
    expect(wrapText("one two three four", 90, byChars, 2)).toEqual(["one two", "three…"]);
  });

  it("keeps a single long word on its own line", () => {
    expect(wrapText("Ecosystem", 20, byChars)).toEqual(["Ecosystem"]);
  });
});

describe("coverCrop", () => {
  it("covers 1200 x 630 from a 21:9 hero without leaving a gap", () => {
    const { resize, extract } = coverCrop(1568, 672, 1200, 630);
    expect(resize.height).toBe(630);
    expect(extract.left + extract.width).toBeLessThanOrEqual(resize.width);
    expect(extract.width).toBe(1200);
  });

  it("clamps the focal point so the box stays inside the image", () => {
    const { extract, resize } = coverCrop(1568, 672, 1200, 630, { x: 1, y: 0.5 });
    expect(extract.left).toBe(resize.width - 1200);
  });
});

describe("portraitPlacement (L17)", () => {
  it("stands a 4:5 keeper portrait whole at the right, full card height", () => {
    const { resize, left, top } = portraitPlacement(960, 1200, 1200, 630);
    expect(resize).toEqual({ width: 504, height: 630 });
    expect(left + resize.width).toBe(1200);
    expect(top).toBe(0);
  });
});

describe("keeper disclosure on cards (L17, hard constraint 10)", () => {
  it("says AI agent on every card whose art shows a keeper, in its name or its caption", () => {
    const keeperCards = parseCards(CARDS, REGIONS).filter((c: { art?: string }) => isKeeperArt(c.art));
    expect(keeperCards.length).toBeGreaterThan(0);
    for (const card of keeperCards) {
      const caption = disclosureCaption(card) ?? "";
      expect(`${card.title} ${caption}`, card.id).toContain(DISCLOSURE);
    }
  });

  // Only the brand keeper portraits show a keeper; every other brand picture
  // was viewed (2026-11-15) and shows none. The old asset keys are gone.
  it("counts only the brand keeper portraits as keeper art, and captions a card drawn on one", () => {
    for (const id of ["communitas", "resourcus", "publicus"]) {
      expect(isKeeperArt(`brand/${id}`), id).toBe(true);
      expect(isKeeperArt(`brand/${id}-small`), id).toBe(true);
    }
    for (const key of ["passage", "founders", "guides", "stone", "boulder", "golden", "denver", "springs", "fortcollins"]) {
      expect(isKeeperArt(`brand/${key}`), key).toBe(false);
    }
    for (const key of ["hero/hall", "agents/publicus", "regions/space-peak", "brand/communitas-large", undefined]) {
      expect(isKeeperArt(key), String(key)).toBe(false);
    }
    const card = { id: "x", title: "Startup Resources", art: "brand/resourcus" };
    expect(disclosureCaption(card)).toBe(DISCLOSURE_CAPTION);
    expect(disclosureCaption({ ...card, title: "Our AI agents" })).toBeNull();
    expect(disclosureCaption({ ...card, art: "brand/golden" })).toBeNull();
    // The check reads the art a card was drawn on, after any fallback.
    const guides = { id: "g", title: "Guides", art: "brand/guides" };
    expect(disclosureProblem(guides, ["Guides"], "brand/publicus")).toMatch(/does not say "AI agent"/);
    expect(disclosureProblem(guides, ["Guides", DISCLOSURE_CAPTION], "brand/publicus")).toBeNull();
  });

  // Brand v3: each region card draws on its brand place painting, whose crowds
  // are community folk, not keepers, so it needs no keeper caption.
  it("draws each region card on its brand place painting, with no keeper caption", () => {
    const regionCards = parseCards(CARDS, REGIONS).filter((c: { region?: string }) => c.region);
    expect(regionCards.map((c: { region: string }) => c.region).sort()).toEqual(Object.keys(REGIONS).sort());
    for (const card of regionCards) {
      expect(card.art, card.id).toMatch(/^brand\//);
      expect(isKeeperArt(card.art), card.id).toBe(false);
      expect(disclosureCaption(card), card.id).toBeNull();
    }
  });

  it("passes a keeper card whose rendered lines carry the disclosure whole", () => {
    const card = { id: "x", art: "brand/resourcus" };
    expect(disclosureProblem(card, ["Startup Resources", DISCLOSURE_CAPTION])).toBeNull();
    expect(disclosureProblem({ id: "y", art: "brand/communitas" }, ["No disclosure here"])).toMatch(/does not say "AI agent"/);
    expect(disclosureProblem({ id: "z", art: "brand/passage" }, ["No keeper here"])).toBeNull();
  });

  it("flags a keeper card that lacks the disclosure or whose text wrapping cut short", () => {
    const card = { id: "x", art: "brand/publicus" };
    expect(disclosureProblem(card, ["Dispatches"])).toMatch(/does not say "AI agent"/);
    expect(disclosureProblem(card, ["Dispatches by our AI agent and…"])).toMatch(/cut short/);
  });
});

describe("textLayout (brand composition)", () => {
  it("puts the red rule at the top left, the name under it, and the caption one line under the name", () => {
    expect(textLayout(1, false)).toEqual({ rule: 72, title: [152], caption: null });
    expect(textLayout(2, true)).toEqual({ rule: 72, title: [152, 226], caption: 278 });
  });

  it("keeps the name and caption in the card's top half", () => {
    expect(textLayout(2, true).caption!).toBeLessThan(630 / 2);
  });
});

describe("parseFocus and xmlEscape", () => {
  it("reads CSS-style percentages and defaults to center", () => {
    expect(parseFocus("30% 40%")).toEqual({ x: 0.3, y: 0.4 });
    expect(parseFocus(undefined)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("escapes markup in card titles", () => {
    expect(xmlEscape(`Founders & "friends" <here>`)).toBe("Founders &amp; &quot;friends&quot; &lt;here&gt;");
  });
});

// scripts/og/build.mjs falls back to brand/golden for a card with no art of its
// own, and exits 3 when that is missing too. This keeps the fallback in the
// repo, so a deleted file fails here first.
describe("fallback art", () => {
  it("brand/golden is committed where the card build reads it", () => {
    expect(existsSync(path.join(ROOT, "site/public/art/brand/golden.jpg"))).toBe(true);
  });
});
