// /styleguide/ over the built site (run `npm run build` first; test:content
// does). #252: Color, Contrast and Type are spaced like the later sections,
// the contrast table uses the column, and swatches, the table and the prop
// docs fit a phone. axe at 375 px found eight scroll containers that took no
// focus; the docs now wrap instead of scrolling, and the one scroller left
// takes focus and a name.
import { describe, expect, it } from "vitest";

import { readDist } from "../pages";
import { cssRules, declFor, pageCss, rulesFor } from "./css";

const html = readDist("styleguide/index.html");
const doc = new DOMParser().parseFromString(html, "text/html");
const css = pageCss(html);

/** The section a heading opens, or null when the heading is not its band's first child. */
const sectionOf = (id: string) => {
  const h2 = doc.getElementById(id)!;
  return h2.parentElement?.firstElementChild === h2 ? h2.closest("section") : null;
};
const tone = (s: Element | null | undefined) =>
  [...(s?.classList ?? [])].find((c) => c === "section--lit" || c === "section--band");

describe("/styleguide/ Color, Contrast and Type spacing (#252)", () => {
  it("opens a band of its own for Contrast and for Type", () => {
    expect(sectionOf("contrast")).not.toBeNull();
    expect(sectionOf("type")).not.toBeNull();
    expect(sectionOf("button")).not.toBeNull();
  });

  it("alternates lit and band from Color through Button", () => {
    const color = doc.getElementById("color")!.closest("section");
    const tones = [color, sectionOf("contrast"), sectionOf("type"), sectionOf("button")].map(tone);
    expect(tones).toEqual(["section--lit", "section--band", "section--lit", "section--band"]);
  });

  it("puts a 64 px gap above an H2 that follows content in its band", () => {
    expect(declFor(css, ".stack > h2:not(:first-child)", "margin-top")).toBe("var(--s-8)");
    // Color follows the section index, so the rule reaches it.
    expect(doc.getElementById("color")!.matches(".stack > h2:not(:first-child)")).toBe(true);
  });
});

describe("/styleguide/ contrast table width (#252)", () => {
  it("fills the column up to 48rem and sets no minimum width", () => {
    expect(declFor(css, ".sg-contrast", "width")).toBe("100%");
    expect(declFor(css, ".sg-contrast", "max-width")).toBe("48rem");
    expect(rulesFor(css, ".sg-contrast").some((r) => "min-width" in r.decls)).toBe(false);
  });

  it("gives the cells less side padding on a phone", () => {
    const phone = rulesFor(css, ".sg-contrast :is(th,td)").find((r) => r.at.startsWith("@media") && r.at.includes("40rem"));
    expect(phone?.decls["padding-inline"]).toBe("var(--s-2)");
  });
});

describe("/styleguide/ on a phone (#252)", () => {
  it("sets two swatches to a row below 40rem, with a 36 px chip", () => {
    const phone = rulesFor(css, ".swatches").find((r) => r.at.startsWith("@media") && r.at.includes("40rem"));
    expect(phone?.decls["grid-template-columns"]).toBe("repeat(2,minmax(0,1fr))");
    // The phone rule must come after the base rule, or the 48 px chip wins.
    const chips = cssRules(css).filter((r) => r.selectors.includes(".chipcolor") && "width" in r.decls);
    expect(chips.map((r) => [r.at.startsWith("@media"), r.decls.width])).toEqual([
      [false, "48px"],
      [true, "36px"],
    ]);
  });

  it("wraps each prop doc line instead of scrolling it", () => {
    expect(declFor(css, ".sg-doc li", "white-space")).toBe("pre-wrap");
    expect(rulesFor(css, ".sg-doc").some((r) => "overflow-x" in r.decls || "overflow" in r.decls)).toBe(false);
    expect(doc.querySelectorAll("ul.sg-doc").length).toBeGreaterThan(0);
  });

  it("gives every scroll container in main focus and a name", () => {
    const scrollers = new Set<Element>();
    for (const rule of cssRules(css)) {
      const value = rule.decls["overflow-x"] ?? rule.decls["overflow"] ?? "";
      if (!/\b(auto|scroll)\b/.test(value)) continue;
      for (const selector of rule.selectors) {
        let found: Element[] = [];
        try {
          found = [...doc.querySelectorAll(`main ${selector}`)];
        } catch {
          continue; // a pseudo-element or a selector jsdom cannot read
        }
        found.forEach((el) => scrollers.add(el));
      }
    }
    expect([...scrollers].map((el) => el.className)).toContain("sg-scroll");
    for (const el of scrollers) {
      expect(el.getAttribute("tabindex"), el.className).toBe("0");
      const named = el.getAttribute("aria-label") ?? doc.getElementById(el.getAttribute("aria-labelledby") ?? "")?.textContent;
      expect(named?.trim(), el.className).toBeTruthy();
    }
    expect(doc.getElementById(doc.querySelector(".sg-scroll")!.getAttribute("aria-labelledby")!)?.textContent).toBe(
      "Contrast",
    );
  });
});
