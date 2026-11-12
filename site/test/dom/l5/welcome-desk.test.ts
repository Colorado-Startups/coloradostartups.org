import { readFileSync } from "node:fs";
import path from "node:path";

import { VISITOR_KINDS, WAYS_IN } from "@cs/shared";
import axe from "axe-core";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { readDist, SITE_DIR } from "../pages";

// The welcome desk as it ships: built HTML from dist/ (run `npm run build`
// first; test:content does). The desk must work with no JavaScript at all, so
// these tests read the static markup and never run a script.

const routes = parse(readFileSync(path.join(SITE_DIR, "../data/communitas/routes.yaml"), "utf8")) as {
  id: string;
  label: string;
}[];
const dwarves = parse(readFileSync(path.join(SITE_DIR, "../data/team/dwarves.yaml"), "utf8")) as {
  id: string;
  disclosure: string;
}[];
const disclosure = dwarves.find((d) => d.id === "communitas")!.disclosure;

let doc: Document;
let desk: HTMLElement;

beforeAll(() => {
  doc = new DOMParser().parseFromString(readDist("index.html"), "text/html");
  desk = doc.querySelector<HTMLElement>(".welcome-desk")!;
});

const isWayIn = (href: string) =>
  Object.values(WAYS_IN).includes(href) || href.startsWith(`${WAYS_IN.canvas}#`);

describe("welcome desk on the home page", () => {
  it("is on the page, with a heading that labels it", () => {
    expect(desk).not.toBeNull();
    const labelledBy = desk.getAttribute("aria-labelledby")!;
    expect(doc.getElementById(labelledBy)?.textContent).toMatch(/Where do you want to start\?/);
  });

  it("offers one door per visitor kind, in routes.yaml order", () => {
    const summaries = [...desk.querySelectorAll("details > summary")].map((s) => s.textContent?.trim());
    expect(summaries).toEqual(routes.map((r) => r.label));
    expect(summaries).toHaveLength(VISITOR_KINDS.length);
  });

  it("puts every door in one group, so opening one closes the others", () => {
    const names = new Set([...desk.querySelectorAll("details")].map((d) => d.getAttribute("name")));
    expect(names.size).toBe(1);
    expect([...names][0]).toBeTruthy();
  });

  it("shows one to three steps behind each door, each linking through WAYS_IN", () => {
    for (const details of desk.querySelectorAll("details")) {
      const links = [...details.querySelectorAll("a")];
      expect(links.length).toBeGreaterThanOrEqual(1);
      expect(links.length).toBeLessThanOrEqual(3);
      for (const a of links) expect(isWayIn(a.getAttribute("href")!), a.getAttribute("href")!).toBe(true);
    }
  });

  it("offers the founders forum behind the founder doors only (decisions 46 and 49)", () => {
    const founderLabels = routes.filter((r) => ["idea", "building", "hiring"].includes(r.id)).map((r) => r.label);
    for (const details of desk.querySelectorAll("details")) {
      const label = details.querySelector("summary")?.textContent?.trim() ?? "";
      const hrefs = [...details.querySelectorAll("a")].map((a) => a.getAttribute("href"));
      expect(hrefs.includes(WAYS_IN.discourse), label).toBe(founderLabels.includes(label));
    }
  });

  it("never points investors at the Leaderboard (decision 17)", () => {
    const investing = [...desk.querySelectorAll("details")].find((d) =>
      d.querySelector("summary")?.textContent?.includes(routes.find((r) => r.id === "investing")!.label),
    )!;
    const hrefs = [...investing.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain(WAYS_IN.leaderboard);
  });

  it("hands free-text questions to Resourcus on the Canvas", () => {
    const handoff = [...desk.querySelectorAll("a")].find((a) => /Ask Resourcus/.test(a.textContent ?? ""));
    expect(handoff?.getAttribute("href")).toBe(WAYS_IN.canvas);
  });

  it("discloses Communitas as an AI agent, in the words of dwarves.yaml", () => {
    expect(desk.querySelector(".ai-note")?.textContent?.trim()).toBe(disclosure);
  });

  it("needs no JavaScript: no script and no inline handler inside the desk", () => {
    expect(desk.querySelector("script")).toBeNull();
    expect(desk.outerHTML).not.toMatch(/\son[a-z]+=/i);
  });

  it("passes axe (structure and ARIA; color contrast runs in the browser e2e)", async () => {
    const results = await axe.run(desk, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
