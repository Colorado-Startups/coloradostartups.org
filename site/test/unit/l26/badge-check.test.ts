// L26, #268: the badge check fails a stale badge, and never calls a font
// change stale. Google Fonts does not always serve the same Cinzel, so the
// check compares SVGs only when the fonts match badge-fonts.json; otherwise it
// reports "could not check", which the DOM test turns into a skip. #380: in
// CI that skip warns, and the build's own folder wins the font pick.
// Hermetic: stand-in fonts draw each letter as a box, so no build is needed.
import { describe, expect, it } from "vitest";

import { pickFont } from "../../../../scripts/og/lib.mjs";
import { KIT_BADGES } from "../../../src/components/kit/badges";
import {
  checkBadges,
  couldNotCheckWarning,
  fontRecord,
  loadFontRecord,
  loadTokens,
  renderBadgeSvg,
} from "../../../src/components/kit/build-badges.mjs";

// A letter as a box whose width depends on the letter, so the path data
// changes with the words.
function box(ch: string) {
  const advanceWidth = 400 + (ch.codePointAt(0)! % 7) * 50;
  let sx = 1;
  let at = [0, 0];
  const path = {
    scale(x: number) {
      sx = x;
      return path;
    },
    translate(x: number, y: number) {
      at = [x, y];
      return path;
    },
    toSVG: () => `M${at[0]} ${at[1]}h${advanceWidth * sx}v${-700 * sx}h${-advanceWidth * sx}Z`,
  };
  return { advanceWidth, path };
}

const face = (family: string, sha256: string) => ({
  font: { familyName: family, unitsPerEm: 1000, glyphsForString: (text: string) => [...text].map(box) },
  embolden: 0,
  file: `dist/_astro/fonts/${family.replace(/ /g, "-")}.woff2`,
  sha256,
});

const FONTS = {
  title: face("Cinzel", "a".repeat(64)),
  kicker: face("Alegreya Sans", "b".repeat(64)),
  status: face("Alegreya Sans Medium", "c".repeat(64)),
};
const RECORD = fontRecord(FONTS);
const TOKENS = loadTokens();
// What the repo would hold had the badges been drawn with FONTS.
const COMMITTED = new Map(KIT_BADGES.map((b) => [b.id, renderBadgeSvg(b, TOKENS, FONTS)]));
const read = (id: string) => COMMITTED.get(id);
const ids = (r: { stale: { id: string }[] }) => r.stale.map((s) => s.id);

describe("the badge check, when the fonts match the record", () => {
  it("passes when nothing changed", () => {
    expect(checkBadges({ fonts: FONTS, tokens: TOKENS, record: RECORD, read })).toEqual({ stale: [] });
  });

  it("fails every badge when a token changed", () => {
    const tokens = { ...TOKENS, "on-night": "#000000" };
    const result = checkBadges({ fonts: FONTS, tokens, record: RECORD, read });
    expect(result.couldNotCheck).toBeUndefined();
    expect(ids(result)).toEqual(KIT_BADGES.map((b) => b.id));
  });

  it("fails the one badge whose words changed", () => {
    const [first, ...rest] = KIT_BADGES;
    const edited = { ...first!, lines: { ...first!.lines, status: `${first!.lines.status} edited` } };
    const result = checkBadges({ fonts: FONTS, tokens: TOKENS, record: RECORD, read, badges: [edited, ...rest] });
    expect(result.couldNotCheck).toBeUndefined();
    expect(ids(result)).toEqual([first!.id]);
  });
});

describe("the badge check, when a font is not the recorded one", () => {
  it("says it could not check and names the font, never stale", () => {
    const record = { ...RECORD, title: { family: "Cinzel", sha256: "d".repeat(64) } };
    // A changed token too: still not stale, because nothing was compared.
    const result = checkBadges({ fonts: FONTS, tokens: { ...TOKENS, "on-night": "#000000" }, record, read });
    expect(result.stale).toEqual([]);
    expect(result.couldNotCheck).toBe(
      "the title font is Cinzel in dist/_astro/fonts/Cinzel.woff2 (sha256 aaaaaaaaaaaa), not the Cinzel font the badges were drawn with (sha256 dddddddddddd)",
    );
  });

  it("says it could not check when there is no record", () => {
    const result = checkBadges({ fonts: FONTS, tokens: TOKENS, record: undefined, read });
    expect(result.stale).toEqual([]);
    expect(result.couldNotCheck).toMatch(/badge-fonts\.json is missing or unreadable/);
  });
});

describe("badge-fonts.json", () => {
  it("records a family and a sha256 for each role the generator draws with", () => {
    const record = loadFontRecord();
    expect(Object.keys(record)).toEqual(Object.keys(FONTS));
    for (const role of Object.values(record) as { family: string; sha256: string }[]) {
      expect(role.family).toMatch(/^(Cinzel|Alegreya Sans)\b/);
      expect(role.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("the could-not-check warning", () => {
  const reason = "the title font is Cinzel SemiBold in dist/_astro/fonts/x.woff2 (sha256 c3b7d5cbea13)";

  it("is a GitHub ::warning:: naming the font when run in GitHub Actions", () => {
    expect(couldNotCheckWarning(reason, { GITHUB_ACTIONS: "true" })).toBe(
      `::warning title=could not check (badge SVGs)::badges: could not check: ${reason}`,
    );
  });

  it("stays one workflow command when the reason holds a newline or a percent sign", () => {
    const warning = couldNotCheckWarning("a\nb\r100%", { GITHUB_ACTIONS: "true" })!;
    expect(warning).not.toMatch(/[\r\n]/);
    expect(warning.endsWith("a%0Ab%0D100%25")).toBe(true);
  });

  it("prints nothing outside GitHub Actions", () => {
    expect(couldNotCheckWarning(reason, {})).toBeUndefined();
    expect(couldNotCheckWarning(reason, { CI: "true" })).toBeUndefined();
  });
});

describe("the font pick", () => {
  const DIST = "dist/_astro/fonts";
  const CACHE = "node_modules/.astro/fonts";
  const cinzel = (dir: string, name: string, font: object) => ({
    font: { familyName: "Cinzel", subfamilyName: "Regular", ...font },
    file: `${dir}/${name}.woff2`,
    sha256: name,
  });
  const variable = (dir: string) => cinzel(dir, "variable", { "OS/2": { usWeightClass: 400 }, variationAxes: { wght: { min: 400, default: 400, max: 900 } } });
  const static700 = (dir: string) => cinzel(dir, "static-700", { subfamilyName: "Bold", "OS/2": { usWeightClass: 700 } });

  it("takes the build's variable font over an exact weight left in the cache", () => {
    const picked = pickFont([variable(DIST), static700(CACHE)], "Cinzel", 700);
    expect(picked?.file).toBe(`${DIST}/variable.woff2`);
    expect(picked?.embolden).toBeCloseTo(0.04);
  });

  it("takes an exact weight over a variable font in the same folder", () => {
    const picked = pickFont([variable(DIST), static700(DIST)], "Cinzel", 700);
    expect(picked).toMatchObject({ file: `${DIST}/static-700.woff2`, embolden: 0 });
  });

  it("falls back to the cache when the build's folder has no match", () => {
    expect(pickFont([static700(CACHE)], "Cinzel", 700)?.file).toBe(`${CACHE}/static-700.woff2`);
    expect(pickFont([variable(DIST)], "Alegreya Sans", 700)).toBeUndefined();
  });
});
