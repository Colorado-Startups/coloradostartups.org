import { describe, expect, it } from "vitest";

import { readDist } from "../pages";

// The home page's Leaderboard teaser (#147, item 1): only someone inside a
// company can answer the nomination form, so the button names the company as
// the visitor's own.

const d = new DOMParser().parseFromString(readDist("index.html"), "text/html");
const label = (a: Element) => (a.textContent ?? "").replace(/\s+/g, " ").trim();

describe("home Leaderboard teaser", () => {
  const links = [...d.querySelectorAll('main a[href="/leaderboard/nominate/"]')];

  it("asks the visitor to nominate their own company", () => {
    expect(links.map(label)).toEqual(["Nominate your company"]);
  });
});
