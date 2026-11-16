// S0: the header carries two slots, AskButton (K1, "Ask anywhere") and
// YourRegion (W8, the visitor's region crest). They sit in the nav after the
// links and before "Join the Slack". K1 filled AskButton (the Search button
// and the Ask dialog). W8 filled YourRegion (the Pick your region link, the
// chooser and the picked region's crest). Neither changed the rest of the
// header's markup. The unit project runs in plain Node and cannot compile
// .astro, so these checks read the source.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const UI = path.resolve(__dirname, "../../../src/components/ui");
const read = (file: string) => readFileSync(path.join(UI, file), "utf8");

// Frontmatter, then the template: Astro emits only what follows the second fence.
const template = (source: string) => source.split("---").slice(2).join("---");

// The header's markup (template up to its <script>) on main at b2a8277, before
// S0. K1 and W8 change the header on purpose; they update this hash with it.
// K1 (2026-11-16) filled AskButton and left SiteHeader's own markup alone: the
// hash still holds, and the check below on AskButton replaces its "renders
// nothing" check. The header's styles (after the <script>) gained K1's gaps.
// W8 (2026-11-16) filled YourRegion the same way: only the slot comment's
// words changed, and the check below on YourRegion replaces its own.
// M1c (2026-11-16) marks Join the Slack for the click listener; the hash is
// taken with that one mark removed, so the rest stays pinned.
const MARKUP_BEFORE_S0 = "129944a847f68aa6ad4daee22e2dbf58b793b0a3052821997bd4225e81b81d4e";

const SLOTS = [
  { name: "AskButton", step: "K1" },
  { name: "YourRegion", step: "W8" },
];

const header = read("SiteHeader.astro");

/** A request or a click event: a data-track mark, the track helper, fetch, a beacon or XHR. */
const SENDS = /data-track|dataset\.track|lib\/track|fetch\(|sendBeacon|XMLHttpRequest/;

describe("header slots", () => {
  it("YourRegion (W8) renders a link to /regions/, a hidden chooser button, a hidden picked state and the chooser", () => {
    const region = template(read("header/YourRegion.astro"));
    expect(region).toMatch(/<a class="btn btn--stone your-region__pick" href="\/regions\/" data-region-link>/);
    expect(region).toMatch(/<button class="btn btn--stone your-region__pick" type="button" aria-haspopup="dialog" data-region-open hidden>/);
    expect(region).toContain('<span class="your-region__label">Pick your region</span>');
    expect(region).toMatch(/<div class="your-region__mine" data-region-mine hidden>/);
    expect(region).toMatch(/<template data-region-template>\s*<dialog class="region-chooser"/);
    // Bundled, never inline: no is:inline script.
    expect(region).not.toMatch(/<script[^>]*is:inline/);
  });

  // The pick never leaves the browser: no fetch, no beacon and no click mark
  // in the slot's template, its island or the pick's store.
  for (const [file, source] of [
    ["header/YourRegion.astro", () => template(read("header/YourRegion.astro"))],
    ["header/region-slot.ts", () => read("header/region-slot.ts")],
    ["lib/your-region.ts", () => readFileSync(path.resolve(UI, "../../lib/your-region.ts"), "utf8")],
  ] as const) {
    it(`YourRegion (W8): ${file} sends nothing`, () => {
      const code = source();
      expect(code.length).toBeGreaterThan(0);
      expect(code).not.toMatch(SENDS);
    });
  }

  it("AskButton (K1) renders a link to /ask/, a hidden Search button and the Ask dialog", () => {
    const ask = template(read("header/AskButton.astro"));
    expect(ask).toMatch(/<a class="btn btn--stone ask-trigger" href="\/ask\/" data-ask-link>/);
    expect(ask).toMatch(/<button class="btn btn--stone ask-trigger" type="button"[^>]* data-ask-open hidden>/);
    expect(ask).toContain('<span class="ask-trigger__label">Search</span>');
    expect(ask).toContain("<AskDialog />");
    // Bundled, never inline: no is:inline script in the slot.
    expect(ask).not.toMatch(/<script[^>]*is:inline/);
  });

  for (const { name, step } of SLOTS) {
    it(`${name} (${step}) is imported once and used once`, () => {
      const imports = header.match(new RegExp(`^import ${name} from "\\./header/${name}\\.astro";$`, "gm")) ?? [];
      expect(imports).toHaveLength(1);
      expect(header.match(new RegExp(`<${name}\\b`, "g")) ?? []).toHaveLength(1);
    });
  }

  it("sit in the nav after the links and before Join the Slack, Ask first", () => {
    const at = (needle: string) => header.indexOf(needle);
    expect(at("</ul>")).toBeGreaterThan(at('<nav id="site-nav"'));
    expect(at("<AskButton />")).toBeGreaterThan(at("</ul>"));
    expect(at("<YourRegion />")).toBeGreaterThan(at("<AskButton />"));
    expect(at('class="btn btn--gold cta"')).toBeGreaterThan(at("<YourRegion />"));
  });

  it("leave the rest of the header markup exactly as before", () => {
    const markup = template(header);
    const withoutSlots = markup
      .slice(0, markup.indexOf("<script>"))
      .replace(/^ *\{\/\* Slots for K1 .*\*\/\}\n/m, "")
      .replace(/^ *<AskButton \/>\n/m, "")
      .replace(/^ *<YourRegion \/>\n/m, "")
      .replace(' {...joinAttrs("header")}', "");
    expect(createHash("sha256").update(withoutSlots).digest("hex")).toBe(MARKUP_BEFORE_S0);
  });

  it("marks Join the Slack as join_click from the header (M1c)", () => {
    expect(header).toContain('<a class="btn btn--gold cta" href={WAYS_IN.slack} aria-describedby="header-slack-note" {...joinAttrs("header")}>');
  });
});
