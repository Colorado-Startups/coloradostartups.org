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
  layoutProblem,
  parseCards,
  parseFocus,
  portraitPlacement,
  scrimStops,
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
// BaseLayout.astro links /og/<id>.png; these are the ids the orchestrator asked L7 for.
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
  "get-involved",
  "founders",
  "dispatches",
  "default",
];

describe("cards.txt", () => {
  it("has a card for every required route", () => {
    const ids = parseCards(CARDS, REGIONS).map((c: { id: string }) => c.id);
    expect(ids.sort()).toEqual([...REQUIRED].sort());
  });

  it("takes each region card's words and art from data/regions, L8's single source", () => {
    const cards = parseCards(CARDS, REGIONS);
    for (const id of ["photon-mountain", "space-peak", "fusion-canyon"]) {
      const card = cards.find((c: { id: string }) => c.id === id);
      expect(card.title).toBe(REGIONS[id].name);
      expect(card.subtitle).toBe(REGIONS[id].tagline);
      expect(card.art).toBe(REGIONS[id].art);
    }
  });

  it("rejects a region card whose region has no data file", () => {
    expect(() => parseCards("id: x\nregion: nowhere", REGIONS)).toThrow(/no data\/regions file/);
  });

  it("rejects a card without a title", () => {
    expect(() => parseCards("id: home\nsubtitle: hi")).toThrow(/missing "title"/);
  });

  it("rejects duplicate ids", () => {
    expect(() => parseCards("id: a\ntitle: A\nsubtitle: a\n\nid: a\ntitle: B\nsubtitle: b")).toThrow(/duplicate/);
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
  it("says AI agent on every card whose art shows a keeper, in its words or its caption", () => {
    const keeperCards = parseCards(CARDS, REGIONS).filter((c: { art?: string }) => isKeeperArt(c.art));
    expect(keeperCards.length).toBeGreaterThan(0);
    for (const card of keeperCards) {
      const caption = disclosureCaption(card) ?? "";
      expect(`${card.title} ${card.subtitle} ${caption}`, card.id).toContain(DISCLOSURE);
    }
  });

  // #744: the Great Hall shows keepers, and it is the no-art fallback.
  it("counts the Great Hall as keeper art, and captions a Hall card whose words do not disclose", () => {
    expect(isKeeperArt("hero/hall")).toBe(true);
    expect(isKeeperArt("agents/publicus")).toBe(true);
    expect(isKeeperArt("scenes/founders")).toBe(false);
    const home = { id: "home", title: "Colorado Startups", subtitle: "A community of founders.", art: "hero/hall" };
    expect(disclosureCaption(home)).toBe(DISCLOSURE_CAPTION);
    expect(disclosureCaption({ ...home, subtitle: "Paul and the Hall's three AI agents." })).toBeNull();
    expect(disclosureCaption({ ...home, art: "scenes/founders" })).toBeNull();
    // A card whose own art is missing falls back to the Hall, and the check reads the art it was drawn on.
    const guides = { id: "g", title: "Guides", subtitle: "How to start up here.", art: "scenes/guides" };
    expect(disclosureProblem(guides, ["Guides", "How to start up here."], "hero/hall")).toMatch(/does not say "AI agent"/);
    expect(disclosureProblem(guides, ["Guides", "How to start up here.", DISCLOSURE_CAPTION], "hero/hall")).toBeNull();
  });

  // #761: every region scene has dwarf and gnome helpers, so every region's card discloses.
  it("counts every region's scene as keeper art, and captions each region card", () => {
    const regionCards = parseCards(CARDS, REGIONS).filter((c: { region?: string }) => c.region);
    expect(regionCards.map((c: { region: string }) => c.region).sort()).toEqual(Object.keys(REGIONS).sort());
    for (const card of regionCards) {
      expect(isKeeperArt(card.art), card.id).toBe(true);
      expect(disclosureCaption(card), card.id).toBe(DISCLOSURE_CAPTION);
    }
  });

  it("passes a keeper card whose rendered lines carry the disclosure whole", () => {
    const card = { id: "x", art: "agents/resourcus" };
    expect(disclosureProblem(card, ["Startup", "Resources", "Ask Resourcus, our AI agent, to search it."])).toBeNull();
    expect(disclosureProblem({ id: "y", art: "hero/hall" }, ["No disclosure here"])).toMatch(/does not say "AI agent"/);
    expect(disclosureProblem({ id: "z", art: "scenes/passage" }, ["No keeper here"])).toBeNull();
  });

  it("flags a keeper card that lacks the disclosure or whose text wrapping cut short", () => {
    const card = { id: "x", art: "agents/publicus" };
    expect(disclosureProblem(card, ["Dispatches", "News from the Hall."])).toMatch(/does not say "AI agent"/);
    expect(disclosureProblem(card, ["Dispatches", "Publicus, our AI agent, drafts…"])).toMatch(/cut short/);
  });
});

describe("scrimStops (L17)", () => {
  it("ends a portrait card's scrim at the portrait, after the text column", () => {
    const { left } = portraitPlacement(960, 1200, 1200, 630);
    const { solid, clear } = scrimStops(left);
    expect(clear * 1200).toBe(left);
    expect(solid * 1200).toBeGreaterThanOrEqual(672); // the body text ends at x = 672
  });

  it("keeps the wide-art fade for every other card", () => {
    expect(scrimStops(undefined)).toEqual({ solid: 0.55, clear: 0.82 });
  });
});

describe("textLayout and layoutProblem (#746 review)", () => {
  it("keeps the slots the cards were drawn with", () => {
    expect(textLayout(2, 2, true)).toEqual({ title: [285, 363], rule: 393, body: [449, 489], caption: 530, url: 574 });
    expect(textLayout(1, 3, false)).toEqual({ title: [285], rule: 315, body: [371, 411, 451], caption: null, url: 574 });
  });

  // build.mjs wraps a 1-line title over up to 3 body lines, a 2-line title over up to 2.
  it.each([
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 1],
    [2, 2],
  ])("clears the caption and URL with a %i-line title and %i body lines", (titleCount, bodyCount) => {
    expect(layoutProblem("x", textLayout(titleCount, bodyCount, true))).toBeNull();
    expect(layoutProblem("x", textLayout(titleCount, bodyCount, false))).toBeNull();
  });

  it("fails a card whose subtitle would run into the caption or the URL", () => {
    expect(layoutProblem("x", textLayout(2, 3, true))).toMatch(/card "x": its subtitle runs into its caption/);
    expect(layoutProblem("x", textLayout(2, 4, false))).toMatch(/its subtitle runs into its URL/);
    // A taller face moves the boxes closer: 2 title lines over 2 body lines need under 1.1 em of ascent.
    expect(layoutProblem("x", textLayout(2, 2, true), { ascent: 1.1, descent: 0.3 })).toMatch(/runs into its caption/);
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

describe("team card", () => {
  it("names Ryan Shuken (decision 19)", () => {
    const team = parseCards(CARDS, REGIONS).find((c: { id: string }) => c.id === "team");
    expect(team.subtitle).toContain("Ryan Shuken");
  });
});

// scripts/og/build.mjs falls back to hero/hall for a card with no art of its
// own, and exits 3 when that is missing too (#178 removed the gradient). This
// keeps the fallback in the repo, so a deleted file fails here first.
describe("fallback art", () => {
  it("hero/hall is committed in a format the card build reads", () => {
    const found = ["webp", "png", "jpg"].filter((ext) => existsSync(path.join(ROOT, `site/src/assets/art/hero/hall.${ext}`)));
    expect(found.length).toBeGreaterThan(0);
  });
});
