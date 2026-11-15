// L26, #268: the badge check fails a stale badge, and never calls a font
// change stale. It compares SVGs only when the fonts match badge-fonts.json;
// otherwise it reports "could not check", which the DOM test turns into a
// skip, and in CI that skip warns (#380). Since brand v3 the fonts are
// Aileron from @fontsource/aileron, pinned by package-lock.json.
// Hermetic: stand-in fonts draw each letter as a box, so no build is needed.
import { describe, expect, it } from "vitest";

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
  file: `@fontsource/aileron/files/${family.replace(/ /g, "-")}.woff2`,
  sha256,
});

const FONTS = {
  title: face("Aileron", "a".repeat(64)),
  kicker: face("Aileron", "b".repeat(64)),
  status: face("Aileron", "c".repeat(64)),
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
    const record = { ...RECORD, title: { family: "Aileron", sha256: "d".repeat(64) } };
    // A changed token too: still not stale, because nothing was compared.
    const result = checkBadges({ fonts: FONTS, tokens: { ...TOKENS, "on-night": "#000000" }, record, read });
    expect(result.stale).toEqual([]);
    expect(result.couldNotCheck).toBe(
      "the title font is Aileron in @fontsource/aileron/files/Aileron.woff2 (sha256 aaaaaaaaaaaa), not the Aileron font the badges were drawn with (sha256 dddddddddddd)",
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
      expect(role.family).toMatch(/^Aileron\b/);
      expect(role.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("the could-not-check warning", () => {
  const reason = "the title font is Aileron in @fontsource/aileron/files/x.woff2 (sha256 c3b7d5cbea13)";

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
