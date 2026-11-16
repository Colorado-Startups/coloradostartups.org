// S0: the header carries two empty slots, AskButton (K1, "Ask anywhere") and
// YourRegion (W8, the visitor's region crest). They sit in the nav after the
// links and before "Join the Slack". K1 filled AskButton (the Search button
// and the Ask dialog); YourRegion renders nothing until W8, so the rest of
// the header, the phone menu and the focus order stay as they were. The unit project runs in plain Node and cannot compile
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
const MARKUP_BEFORE_S0 = "129944a847f68aa6ad4daee22e2dbf58b793b0a3052821997bd4225e81b81d4e";

const SLOTS = [
  { name: "AskButton", step: "K1" },
  { name: "YourRegion", step: "W8" },
];

const header = read("SiteHeader.astro");

describe("header slots", () => {
  it("YourRegion (W8) renders nothing yet", () => {
    expect(template(read("header/YourRegion.astro")).trim()).toBe("");
  });

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
      .replace(/^ *<YourRegion \/>\n/m, "");
    expect(createHash("sha256").update(withoutSlots).digest("hex")).toBe(MARKUP_BEFORE_S0);
  });
});
