import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { type KeeperId, portraitAlt } from "../../../src/components/art/keepers";
import { readDist, SITE_DIR } from "../pages";

// Page polish (#209): the small keeper portrait beside each keeper's name on
// the home page, the welcome desk (/ and /community/) and the Publicus intro
// on /dispatches/. Each portrait's alt text says the keeper is an AI agent,
// and each visible disclosure line stays.

const dwarves = parse(readFileSync(path.join(SITE_DIR, "../data/team/dwarves.yaml"), "utf8")) as {
  id: KeeperId;
  name: string;
  title: string;
  disclosure: string;
}[];
const keeper = (id: KeeperId) => dwarves.find((d) => d.id === id)!;
const doc = (rel: string) => new DOMParser().parseFromString(readDist(rel), "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** The small portrait of a keeper inside a scope, checked for its crop and its alt text. */
function expectSmallPortrait(scope: Element, id: KeeperId) {
  const fig = scope.querySelector(`[data-portrait="${id}"]`);
  expect(fig, id).not.toBeNull();
  expect(fig!.classList.contains("portrait--small"), id).toBe(true);
  const img = fig!.querySelector("img");
  expect(img?.getAttribute("src"), id).toContain(`${id}-small`);
  const k = keeper(id);
  expect(img?.getAttribute("alt"), id).toBe(portraitAlt(id, k.name, k.title));
  expect(img?.getAttribute("alt"), id).toMatch(/an AI agent/);
}

describe("home keeper teasers", () => {
  const main = doc("index.html").querySelector("main")!;

  it("head every keeper card with its small portrait, and keep the badge and the disclosure", () => {
    for (const k of dwarves) {
      const card = main.querySelector(`[data-keeper="${k.id}"]`)!;
      expectSmallPortrait(card, k.id);
      expect(text(card.querySelector("h3"))).toBe(k.name);
      expect(text(card.querySelector(".hall-card__badges"))).toContain("AI agent");
      expect(text(card.querySelector(".ai-note"))).toBe(k.disclosure);
    }
  });
});

describe.each([
  ["home", "index.html"],
  ["/community/", "community/index.html"],
])("welcome desk on %s", (_name, rel) => {
  const desk = doc(rel).querySelector(".welcome-desk")!;

  it("shows Communitas beside the heading and the line that names it", () => {
    const head = desk.querySelector(".desk-head")!;
    expectSmallPortrait(head, "communitas");
    expect(head.querySelector("h3")).not.toBeNull();
    expect(text(head.querySelector("p"))).toContain("Communitas");
  });

  it("keeps the disclosure line from dwarves.yaml", () => {
    expect(text(desk.querySelector(".ai-note"))).toBe(keeper("communitas").disclosure);
  });
});

describe("/dispatches/ intro", () => {
  const main = doc("dispatches/index.html").querySelector("main")!;

  it("shows Publicus beside the lines that name it, with the disclosure in full", () => {
    const herald = main.querySelector(".herald")!;
    expectSmallPortrait(herald, "publicus");
    expect(herald.querySelector('a[href="/team/#publicus"]')).not.toBeNull();
    expect(text(herald.querySelector("[data-disclosure]"))).toBe(keeper("publicus").disclosure);
  });
});
