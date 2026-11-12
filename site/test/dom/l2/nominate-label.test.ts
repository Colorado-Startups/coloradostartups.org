// L2 over the built site (run `npm run build` first): the Leaderboard's links
// to the nomination form say "Nominate your company" (#147). The form asks for
// two years of revenue, the headcount and "I can speak for this company",
// which only someone inside the company can answer.
import { describe, expect, it } from "vitest";

import { readDist } from "../pages";

const parse = (file: string) => new DOMParser().parseFromString(readDist(file), "text/html");

describe("the Leaderboard's nomination wording (#147)", () => {
  const board = parse("leaderboard/index.html");
  const form = parse("leaderboard/nominate/index.html");

  it("labels every link to the form on /leaderboard/ for an insider", () => {
    const links = [...board.querySelectorAll('main a[href="/leaderboard/nominate/"]')].map((a) => a.textContent?.trim() ?? "");
    expect(links.length).toBeGreaterThan(0);
    for (const text of links) expect(text).toMatch(/^Nominate your company/);
  });

  it("heads the form page the same way", () => {
    expect(form.querySelector("h1")?.textContent?.trim()).toBe("Nominate your company");
    expect(form.title).toMatch(/^Nominate your company/);
  });
});
