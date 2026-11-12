import { describe, expect, it } from "vitest";

import { contentPages } from "../pages";

// L5a, card "Use one kicker style above page titles" (#217): the small label
// right above a page's h1 wears the shared .kicker from global.css, never a
// style of its own. Right above the h1 there may be that label, a breadcrumb
// trail, or nothing; anything else fails unless ELSEWHERE names the page.
// Run `npm run build` first.

/** What sits right above the page's first h1: "kicker", "breadcrumb", "nothing", or the element. */
export function aboveTitle(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const h1 = doc.querySelector("h1");
  if (!h1) return "no h1";
  const prev = h1.previousElementSibling;
  if (!prev) return "nothing";
  if (prev.matches("p.kicker")) return "kicker";
  if (prev.matches("nav.crumbs")) return "breadcrumb";
  return `${prev.tagName.toLowerCase()}${[...prev.classList].map((c) => `.${c}`).join("")}`;
}

const SHARED = new Set(["kicker", "breadcrumb", "nothing"]);

// Pages where something else stands above the title, and why.
const ELSEWHERE: Record<string, string> = {
  // A link back to the directory, not a label (L5b's page).
  "/ecosystem-canvas/suggest/": "p",
};

// Pages that carry a kicker today (production, read 2026-11-04). A page that
// loses its label fails here.
const LABELLED = [
  "/404.html",
  "/code-of-conduct/",
  "/contact/",
  "/dispatches/2026-10-06-a-new-chapter/",
  "/event-calendar/",
  "/founders/",
  "/get-involved/fusion-canyon-connector/",
  "/get-involved/photon-mountain-connector/",
  "/get-involved/slack-community-lead/",
  "/get-involved/space-peak-connector/",
  "/newsletter/",
  "/newsletter/thanks/",
  "/privacy/",
  "/regions/",
];

describe("aboveTitle", () => {
  it("names a kicker, a breadcrumb or nothing (known clean)", () => {
    expect(aboveTitle('<p class="kicker">The rules</p><h1>Code</h1>')).toBe("kicker");
    expect(aboveTitle('<p class="kicker"><a href="/dispatches/">Dispatches</a></p><h1>A new chapter</h1>')).toBe("kicker");
    expect(aboveTitle('<nav class="crumbs"><ol></ol></nav><h1>Guide</h1>')).toBe("breadcrumb");
    expect(aboveTitle("<div><h1>Team</h1></div>")).toBe("nothing");
  });

  it("names anything else by its element and classes (known bad)", () => {
    expect(aboveTitle('<p class="seat-kicker">Volunteer seat</p><h1>Lead</h1>')).toBe("p.seat-kicker");
    expect(aboveTitle('<span class="kicker">Label</span><h1>Lead</h1>')).toBe("span.kicker");
    expect(aboveTitle('<p><a href="/">Back</a></p><h1>Suggest</h1>')).toBe("p");
    expect(aboveTitle("<p>No title here</p>")).toBe("no h1");
  });
});

describe("what stands above every built page's title", () => {
  const pages = contentPages().map((page) => ({ route: page.route, above: aboveTitle(page.html) }));

  for (const { route, above } of pages) {
    it(`${route}: ${above}`, () => {
      expect(SHARED.has(above) || ELSEWHERE[route] === above, `${route} has ${above} above its h1`).toBe(true);
    });
  }

  it("keeps the kicker on every page that has one today", () => {
    const labelled = pages.filter((p) => p.above === "kicker").map((p) => p.route);
    expect(labelled).toEqual(expect.arrayContaining(LABELLED));
  });
});
