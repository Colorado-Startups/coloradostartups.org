// /founders/ and the 404 page over the built site (run `npm run build`
// first; test:content does).
//   - #218: the founders forum's one action, Join the Slack, sits under the
//     lede in the first section, so it shows in the first screen.
//   - #212: each page shows one piece of Hall art the site already ships,
//     through ArtImage, after the text in source order so a phone reads the
//     words and the button first. Neither shows a keeper, so neither adds an
//     AI disclosure surface.
import { WAYS_IN } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { readDist } from "../pages";
import { pageCss, rulesFor } from "./css";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const FOLLOWS = 4; // Node.DOCUMENT_POSITION_FOLLOWING

/** The page's ArtImage figures: the asset key, its <img> and the section it sits in. */
function artOf(doc: Document) {
  return [...doc.querySelectorAll<HTMLElement>("main figure[data-art]")].map((figure) => ({
    figure,
    key: figure.dataset.art ?? "",
    img: figure.querySelector("img"),
    section: figure.closest("section"),
  }));
}

/** The grid columns a selector gets inside a min-width 64rem media rule. */
function columnsAt64(css: string, selector: string) {
  const wide = rulesFor(css, selector).find((r) => r.at.startsWith("@media") && r.at.includes("64rem"));
  return wide?.decls["grid-template-columns"];
}

describe("/founders/ first screen (#218, #212)", () => {
  const html = readDist("founders/index.html");
  const doc = parse(html);
  const hero = doc.querySelector("main section")!;

  it("puts Join the Slack in a btn-row under the lede in the first section", () => {
    const row = hero.querySelector(".btn-row");
    const lede = hero.querySelector(".lede")!;
    const link = row?.querySelector<HTMLAnchorElement>(`a[href="${WAYS_IN.slack}"]`);
    expect(link?.textContent?.trim()).toBe("Join the Slack");
    expect(link?.classList.contains("btn--gold")).toBe(true);
    expect(row?.querySelectorAll("a, button")).toHaveLength(1);
    expect(lede.compareDocumentPosition(row!) & FOLLOWS).toBeTruthy();
  });

  it("keeps the closing Slack and newsletter buttons", () => {
    const when = doc.getElementById("when")!.closest("section")!;
    expect(when.querySelector(`a[href="${WAYS_IN.slack}"]`)).not.toBeNull();
    expect(when.querySelector(`a[href="${WAYS_IN.newsletter}"]`)).not.toBeNull();
  });

  it("shows the founders scene in the first section, after the button", () => {
    const art = artOf(doc);
    // L6's scene made for this page (#713), in place of the Great Hall.
    expect(art.map((a) => a.key)).toEqual(["scenes/founders"]);
    const [{ figure, img, section }] = art;
    expect(section).toBe(hero);
    expect(img, "the art file exists, so no placeholder").not.toBeNull();
    expect(img!.getAttribute("alt")).toMatch(/^Founders /);
    expect(img!.getAttribute("loading")).toBe("eager");
    expect(hero.querySelector(".btn-row")!.compareDocumentPosition(figure) & FOLLOWS).toBeTruthy();
  });

  it("sets the text and the art side by side from 64rem", () => {
    expect(columnsAt64(pageCss(html), ".hero__grid")).toBe("repeat(2,minmax(0,1fr))");
  });

  it("leaves the kicker to the global class, with no scoped override (#419)", () => {
    expect(hero.querySelector(".kicker")?.textContent?.trim()).toBe("Coming later");
    expect(pageCss(html)).not.toMatch(/\.kicker\[data-astro-cid-/);
  });
});

describe("404 art (#212)", () => {
  const html = readDist("404.html");
  const doc = parse(html);

  it("shows one piece of existing Hall art after the way home", () => {
    const art = artOf(doc);
    expect(art).toHaveLength(1);
    const [{ figure, key, img }] = art;
    // L6's passage to a blank wall (#711), made for this page; no keeper in it.
    expect(key).toBe("scenes/passage");
    expect(img, "the art file exists, so no placeholder").not.toBeNull();
    expect(img!.getAttribute("alt")?.length).toBeGreaterThan(20);
    const home = doc.querySelector('main a[href="/"]')!;
    expect(home.compareDocumentPosition(figure) & FOLLOWS).toBeTruthy();
  });

  it("sets the text and the art side by side from 64rem, the text wider", () => {
    expect(columnsAt64(pageCss(html), ".lost")).toBe("minmax(0,7fr) minmax(0,5fr)");
  });
});

describe("no keeper art on either page", () => {
  it.each(["founders/index.html", "404.html"])("%s shows no keeper portrait", (file) => {
    const keys = artOf(parse(readDist(file))).map((a) => a.key);
    expect(keys.filter((k) => k.startsWith("agents/"))).toEqual([]);
  });
});
