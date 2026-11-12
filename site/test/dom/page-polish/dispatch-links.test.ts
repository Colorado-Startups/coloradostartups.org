// A dispatch page and /links/ over the built site (run `npm run build`
// first; test:content does).
//   - #260: the reading column's width sits on an inner div, not on .wrap,
//     so the column keeps the header's left gutter.
//   - #261: a small picture of the Great Hall sits between the body and the
//     tags, as decoration.
//   - #419: the breadcrumb wears the shared .kicker, and the tags are Badges.
//   - #420: the breadcrumb and the closing link are tap targets.
import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HALL_ART_ALT } from "../../../src/components/art/keepers";
import { DIST_DIR, readDist } from "../pages";
import { declFor, pageCss, rulesFor } from "./css";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const FOLLOWS = 4; // Node.DOCUMENT_POSITION_FOLLOWING
const ids = readdirSync(path.join(DIST_DIR, "dispatches"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe("dispatch pages", () => {
  it("has at least one dispatch to check", () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  describe.each(ids)("/dispatches/%s/", (id) => {
    const html = readDist(`dispatches/${id}/index.html`);
    const doc = parse(html);
    const column = doc.querySelector("main .dispatch")!;

    it("keeps the measure on an inner column, not on .wrap (#260)", () => {
      expect(column.parentElement?.classList.contains("wrap")).toBe(true);
      expect(column.classList.contains("wrap")).toBe(false);
      expect(declFor(pageCss(html), ".dispatch", "max-width")).toBe("var(--t-measure)");
    });

    it("sets the breadcrumb in the shared kicker, as a tap target (#419, #420)", () => {
      const crumb = column.firstElementChild!;
      expect(crumb.tagName).toBe("P");
      expect(crumb.classList.contains("kicker")).toBe(true);
      const link = crumb.querySelector("a")!;
      expect(link.getAttribute("href")).toBe("/dispatches/");
      expect(link.classList.contains("tap-target")).toBe(true);
    });

    it("makes the closing link a tap target too", () => {
      const back = [...column.querySelectorAll("a[href='/dispatches/']")].at(-1)!;
      expect(back.textContent?.trim()).toBe("All dispatches");
      expect(back.classList.contains("tap-target")).toBe(true);
    });

    it("renders each tag as a Badge, not a chip (#419)", () => {
      const tags = [...column.querySelectorAll(".dispatch__tags > li")];
      for (const li of tags) {
        expect(li.classList.contains("hall-badge"), li.outerHTML).toBe(true);
        expect(li.classList.contains("chip"), li.outerHTML).toBe(false);
      }
    });

    it("puts one Hall picture between the body and the tags, its keepers disclosed (#261, #714)", () => {
      const seals = [...column.querySelectorAll<HTMLElement>(":scope > figure[data-art]")];
      expect(seals.map((f) => f.dataset.art)).toEqual(["hero/hall"]);
      const seal = seals[0]!;
      const img = seal.querySelector("img");
      expect(img, "the art file exists, so no placeholder").not.toBeNull();
      expect(img!.getAttribute("alt")).toBe(HALL_ART_ALT);
      expect(img!.getAttribute("loading")).toBe("lazy");
      const body = column.querySelector(".dispatch__body")!;
      expect(body.compareDocumentPosition(seal) & FOLLOWS).toBeTruthy();
      const after = column.querySelector(".dispatch__tags") ?? [...column.querySelectorAll("a")].at(-1)!;
      expect(seal.compareDocumentPosition(after) & FOLLOWS).toBeTruthy();
    });

    it("spaces the block after the picture, which the stack rule cannot reach", () => {
      expect(declFor(pageCss(html), ".dispatch > .dispatch__seal + *", "margin-top")).toBe("var(--s-5)");
    });
  });
});

describe("/links/ column (#260)", () => {
  const html = readDist("links/index.html");
  const doc = parse(html);
  const css = pageCss(html);

  it("puts each 44rem column inside a full-width .wrap", () => {
    expect(doc.querySelectorAll("main .wrap.narrow")).toHaveLength(0);
    const columns = [...doc.querySelectorAll("main .narrow")];
    expect(columns).toHaveLength(2);
    for (const c of columns) expect(c.parentElement?.classList.contains("wrap")).toBe(true);
  });

  it("caps the column with max-width and sets no width of its own", () => {
    expect(declFor(css, ".narrow", "max-width")).toBe("44rem");
    expect(rulesFor(css, ".narrow").some((r) => "width" in r.decls)).toBe(false);
  });
});
