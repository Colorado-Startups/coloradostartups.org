import { describe, expect, it } from "vitest";

import { readDist } from "../pages";
import { pageCss } from "./css";

// #419: page titles use the one global .kicker from global.css (#418), not a
// scoped copy. A scoped rule shows in the built CSS with Astro's scope on the
// selector, so these tests read the raw CSS rather than cssRules(), which
// strips the scope.

const PAGES = [
  { route: "/privacy/", file: "privacy/index.html" },
  { route: "/contact/", file: "contact/index.html" },
  { route: "/code-of-conduct/", file: "code-of-conduct/index.html" },
  { route: "/event-calendar/", file: "event-calendar/index.html" },
  { route: "/newsletter/", file: "newsletter/index.html" },
  { route: "/newsletter/thanks/", file: "newsletter/thanks/index.html" },
  { route: "/regions/", file: "regions/index.html" },
  { route: "/404.html", file: "404.html" },
];

const SCOPED_KICKER = /\.kicker(?:::before)?(?:\[data-astro-cid-[\w-]+\]|:where\(\.astro-[\w-]+\))/;

describe.each(PAGES)("$route kicker", ({ file }) => {
  const html = readDist(file);
  const d = new DOMParser().parseFromString(html, "text/html");

  it("sits directly above the h1", () => {
    const h1 = d.querySelector("main h1")!;
    expect(h1.previousElementSibling?.classList.contains("kicker")).toBe(true);
    expect((h1.previousElementSibling?.textContent ?? "").trim()).not.toBe("");
  });

  it("takes its look from the global class only", () => {
    expect(pageCss(html)).not.toMatch(SCOPED_KICKER);
    expect(d.querySelector("main .kicker")!.classList.contains("meta")).toBe(false);
  });
});

describe("the scoped-kicker check", () => {
  it("catches both of Astro's scoping forms and passes the global rule", () => {
    expect(".kicker[data-astro-cid-abc123]{color:red}").toMatch(SCOPED_KICKER);
    expect(".kicker::before:where(.astro-abc123){width:1em}").toMatch(SCOPED_KICKER);
    expect(".kicker{color:red}.kicker::before{width:1em}").not.toMatch(SCOPED_KICKER);
  });
});
