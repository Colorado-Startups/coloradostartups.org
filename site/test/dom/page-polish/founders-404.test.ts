// /founders/ and the 404 page over the built site (run `npm run build`
// first; test:content does).
//   - #218: the founders forum's main action sits under the lede in the
//     first section, so it shows in the first screen. Since step F1 that is
//     Join the waitlist, a link to the form; Join the Slack is the second.
//   - #212: each page shows one piece of Hall art the site already ships,
//     through ArtImage. Neither shows a keeper, so neither adds an AI
//     disclosure surface.
//   - Paul, 2026-11-16 ("they're supposed to be getting info"): the words
//     and the way forward lead. Each page's art closes it, lazily, after its
//     last action, and its first section holds no picture.
import { WAYS_IN } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { readDist } from "../pages";
import { declFor, pageCss, rulesFor } from "./css";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const FOLLOWS = 4; // Node.DOCUMENT_POSITION_FOLLOWING
const PICTURE = "img, svg[role='img'], [role='img'], video, canvas";

/** The page's ArtImage figures: the asset key, its <img> and the section it sits in. */
function artOf(doc: Document) {
  return [...doc.querySelectorAll<HTMLElement>("main figure[data-art]")].map((figure) => ({
    figure,
    key: figure.dataset.art ?? "",
    img: figure.querySelector("img"),
    section: figure.closest("section"),
  }));
}

/** True when nothing but text follows `el` in main: no heading, form, button or other picture. */
function closesPage(doc: Document, el: Element) {
  const later = [...doc.querySelector("main")!.querySelectorAll(`h1, h2, h3, h4, h5, h6, form, .btn, ${PICTURE}`)];
  return later.every((node) => el.contains(node) || !(el.compareDocumentPosition(node) & FOLLOWS));
}

describe("/founders/ first screen (#218, #212)", () => {
  const html = readDist("founders/index.html");
  const doc = parse(html);
  const hero = doc.querySelector("main section")!;

  it("puts Join the waitlist first and Join the Slack second in a btn-row under the lede (F1)", () => {
    const row = hero.querySelector(".btn-row");
    const lede = hero.querySelector(".lede")!;
    const actions = [...(row?.querySelectorAll<HTMLAnchorElement>("a, button") ?? [])];
    expect(actions).toHaveLength(2);
    const [waitlist, slack] = actions;
    expect(waitlist?.textContent?.trim()).toBe("Join the waitlist");
    expect(waitlist?.getAttribute("href")).toBe("#waitlist");
    expect(waitlist?.classList.contains("btn--gold")).toBe(true);
    expect(doc.getElementById("waitlist")?.querySelector("form[action='/api/waitlist']")).not.toBeNull();
    expect(slack?.textContent?.trim()).toBe("Join the Slack");
    expect(slack?.getAttribute("href")).toBe(WAYS_IN.slack);
    expect(slack?.classList.contains("btn--gold")).toBe(false);
    expect(lede.compareDocumentPosition(row!) & FOLLOWS).toBeTruthy();
  });

  it("keeps a space between the waitlist intro and its privacy link", () => {
    // Seen live on 2026-11-16: "share them.Read the privacy policy". The build drops the line break before the link.
    const intro = doc.getElementById("waitlist")!.querySelector("p")!;
    expect(intro.textContent?.replace(/\s+/g, " ")).toContain("share them. Read the privacy policy.");
  });

  it("turns Who it is for into a checklist, and keeps the Slack and LinkedIn Group line (F1)", () => {
    const who = doc.getElementById("who")!.parentElement!;
    const items = [...who.querySelectorAll("ul.checklist li")];
    const words = items.map((li) => li.querySelector("span:not([aria-hidden])")?.textContent?.trim());
    expect(words).toEqual(["Founder or cofounder", "Building a company in Colorado", "Any stage, from first idea to growth"]);
    // Each line wears a check mark that assistive tech skips.
    for (const li of items) expect(li.querySelector("[aria-hidden='true']")?.textContent?.trim()).toBe("✓");
    expect(who.querySelector("ul.checklist input")).toBeNull();
    expect(who.textContent).toContain("Talent, investors, lenders and service providers are welcome in the Slack");
  });

  it("ends with the waitlist and keeps the newsletter link (F1)", () => {
    const waitlist = doc.getElementById("waitlist")!;
    expect(waitlist.querySelector("form[action='/api/waitlist']")).not.toBeNull();
    expect(waitlist.querySelector(`a[href="${WAYS_IN.newsletter}"]`)?.textContent?.trim()).toBe("Get the newsletter");
    expect(doc.getElementById("when")).toBeNull();
  });

  it("keeps the first section to words and actions, with no picture (2026-11-16)", () => {
    expect(hero.querySelectorAll(PICTURE)).toHaveLength(0);
    expect(hero.querySelector("figure, [data-art], [data-portrait]")).toBeNull();
    // The checklist comes next, so it reaches the first screen on a phone.
    expect(hero.nextElementSibling?.querySelector("ul.checklist")).not.toBeNull();
  });

  it("closes the page with the founders scene, lazily, after the newsletter button", () => {
    const art = artOf(doc);
    // L6's scene made for this page (#713), in place of the Great Hall.
    expect(art.map((a) => a.key)).toEqual(["brand/founders"]);
    const [{ figure, img, section }] = art;
    expect(section).toBe(doc.getElementById("waitlist"));
    expect(img, "the art file exists, so no placeholder").not.toBeNull();
    expect(img!.getAttribute("alt")).toMatch(/^Founders /);
    expect(img!.getAttribute("loading")).toBe("lazy");
    expect(img!.getAttribute("fetchpriority")).not.toBe("high");
    expect(img!.getAttribute("sizes")).toBe("(min-width: 44rem) 40rem, calc(100vw - 48px)");
    const newsletter = doc.getElementById("waitlist")!.querySelector(`a[href="${WAYS_IN.newsletter}"]`)!;
    expect(newsletter.compareDocumentPosition(figure) & FOLLOWS).toBeTruthy();
    expect(closesPage(doc, figure)).toBe(true);
  });

  it("caps the scene at 40rem wide", () => {
    expect(declFor(pageCss(html), "#waitlist .founders-art", "width")?.replace(/\s/g, "")).toBe("min(100%,40rem)");
  });

  it("leaves the kicker to the global class, with no scoped override (#419)", () => {
    expect(hero.querySelector(".kicker")?.textContent?.trim()).toBe("Coming later");
    expect(pageCss(html)).not.toMatch(/\.kicker\[data-astro-cid-/);
  });
});

describe("404 way back and art (#212)", () => {
  const html = readDist("404.html");
  const doc = parse(html);
  const main = doc.querySelector("main")!;

  it("leads with a site search, a plain GET to /ask/?q= that works without JavaScript", () => {
    const form = main.querySelector<HTMLFormElement>("form[role='search']")!;
    expect(form).not.toBeNull();
    expect(form.getAttribute("action")).toBe("/ask/");
    expect(form.getAttribute("method")).toBe("get");
    const input = form.querySelector<HTMLInputElement>("input[type='search'][name='q']")!;
    expect(input).not.toBeNull();
    expect(form.querySelector(`label[for="${input.id}"]`)?.textContent?.trim()).toBe("Search the site");
    // Nothing on the page comes before the search but its words.
    const before = [...main.querySelectorAll(`form, .btn, ${PICTURE}`)][0];
    expect(before).toBe(form);
  });

  it("lists the home page and the header's main sections after the search", () => {
    const form = main.querySelector("form[role='search']")!;
    const ways = main.querySelector("nav.lost__ways")!;
    expect(form.compareDocumentPosition(ways) & FOLLOWS).toBeTruthy();
    const hrefs = [...ways.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    const header = [...doc.querySelectorAll("#site-nav ul > li > a")].map((a) => a.getAttribute("href"));
    expect(header.length).toBeGreaterThan(0);
    expect(hrefs).toEqual(["/", ...header]);
  });

  it("closes with one piece of existing Hall art, lazily, after the way home", () => {
    const art = artOf(doc);
    expect(art).toHaveLength(1);
    const [{ figure, key, img }] = art;
    // L6's passage to a blank wall (#711), made for this page; no keeper in it.
    expect(key).toBe("brand/passage");
    expect(img, "the art file exists, so no placeholder").not.toBeNull();
    expect(img!.getAttribute("alt")?.length).toBeGreaterThan(20);
    expect(img!.getAttribute("loading")).toBe("lazy");
    expect(img!.getAttribute("fetchpriority")).not.toBe("high");
    const home = doc.querySelector('main a[href="/"]')!;
    expect(home.compareDocumentPosition(figure) & FOLLOWS).toBeTruthy();
    expect(closesPage(doc, figure)).toBe(true);
  });

  it("keeps the column at the reading measure, with no side-by-side grid", () => {
    const css = pageCss(html);
    expect(declFor(css, ".lost", "max-width")).toBe("var(--t-measure)");
    for (const rule of rulesFor(css, ".lost")) expect(rule.decls).not.toHaveProperty("grid-template-columns");
  });
});

describe("no keeper art on either page", () => {
  it.each(["founders/index.html", "404.html"])("%s shows no keeper portrait", (file) => {
    const keys = artOf(parse(readDist(file))).map((a) => a.key);
    expect(keys.filter((k) => k.startsWith("agents/"))).toEqual([]);
  });
});
