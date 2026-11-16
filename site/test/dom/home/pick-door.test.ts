// Step P4 over the built site (run `npm run build` first; test:content does):
// the "Pick your door" band on home. It must work with no JavaScript, so
// these tests read the static markup and never run a script. Its word count
// sits under the per-band cap in home-budget.test.ts.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { VISITOR_KINDS, WAYS_IN } from "@cs/shared";
import axe from "axe-core";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { isCommercial } from "../../../src/components/canvas/top-picks";
import { readDist, SITE_DIR } from "../pages";

const DATA = path.join(SITE_DIR, "../data");
const routes = parse(readFileSync(path.join(DATA, "communitas/routes.yaml"), "utf8")) as { id: string; door: string }[];
const dwarves = parse(readFileSync(path.join(DATA, "team/dwarves.yaml"), "utf8")) as { id: string; disclosure: string }[];
const snapshot = JSON.parse(readFileSync(path.join(DATA, "events/upcoming.json"), "utf8")) as {
  events: { url: string | null }[];
};
const eventUrls = new Set(snapshot.events.map((e) => e.url).filter(Boolean));

const resources = readdirSync(path.join(DATA, "resources"), { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => parse(readFileSync(path.join(DATA, "resources", f), "utf8")) as { url?: string; type: string; substage: string });
const commercialUrls = new Set(
  resources.filter((r) => isCommercial(r as Parameters<typeof isCommercial>[0])).map((r) => r.url).filter(Boolean),
);

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

let band: HTMLElement;
let canvasIds: Set<string>;

beforeAll(() => {
  const home = new DOMParser().parseFromString(readDist("index.html"), "text/html");
  band = home.querySelector<HTMLElement>('section[aria-labelledby="pick-door"]')!;
  const canvas = new DOMParser().parseFromString(readDist("ecosystem-canvas/index.html"), "text/html");
  canvasIds = new Set([...canvas.querySelectorAll("[id]")].map((el) => el.id));
});

const doors = () => [...band.querySelectorAll<HTMLDetailsElement>("details.doorway")];

describe("Pick your door on home", () => {
  it("is a band headed Pick your door", () => {
    expect(band).not.toBeNull();
    expect(text(band.querySelector("h2#pick-door"))).toBe("Pick your door");
  });

  it("gives every visitor kind in the data a door, in VISITOR_KINDS order, labelled from routes.yaml", () => {
    expect(doors().map((d) => d.dataset.kind)).toEqual([...VISITOR_KINDS]);
    const label = new Map(routes.map((r) => [r.id, r.door]));
    for (const d of doors()) expect(text(d.querySelector("summary")), d.dataset.kind).toBe(label.get(d.dataset.kind!));
  });

  it("puts every door in one group, so opening one closes the others", () => {
    const names = new Set(doors().map((d) => d.getAttribute("name")));
    expect(names.size).toBe(1);
    expect([...names][0]).toBeTruthy();
  });

  it("opens each door to its Slack thread and its resources link", () => {
    for (const d of doors()) {
      const kind = d.dataset.kind;
      expect(text(d.querySelector('[data-row="slack"]')), kind).toMatch(/^Start in the Slack, (Monday|Wednesday|Friday) thread$/);
      const link = d.querySelector('[data-row="resources"] a');
      expect(text(link), kind).toMatch(/^(Idea|Launch|Growth|Support) picks$|^Startup Resources$/);
    }
  });

  it("shows the next event under the doors, or a link to the calendar when there is none", () => {
    const row = band.querySelector("[data-door-event]")!;
    const shown = [...row.querySelectorAll("li[data-ends]:not([hidden])")];
    const empty = row.querySelector("[data-events-empty]")!;
    expect(shown.length).toBeLessThanOrEqual(1);
    if (shown.length === 1) {
      expect(empty.hasAttribute("hidden")).toBe(true);
      expect(shown[0]!.querySelector("time")?.getAttribute("datetime")).toBeTruthy();
      expect(text(shown[0]!.querySelector("a")).length).toBeGreaterThan(0);
    } else {
      expect(empty.hasAttribute("hidden")).toBe(false);
      expect(empty.querySelector("a")?.getAttribute("href")).toBe(WAYS_IN.events);
    }
  });

  it("links only to WAYS_IN, to a stage's picks that exist on Startup Resources, or to a calendar event", () => {
    const ways = new Set(Object.values(WAYS_IN));
    for (const a of band.querySelectorAll("a")) {
      const href = a.getAttribute("href")!;
      if (href.startsWith(`${WAYS_IN.canvas}#`)) expect(canvasIds.has(href.split("#")[1]!), href).toBe(true);
      else expect(ways.has(href) || eventUrls.has(href), href).toBe(true);
    }
  });

  it("lists no commercial resource (picks are for founders)", () => {
    for (const a of band.querySelectorAll("a")) expect(commercialUrls.has(a.getAttribute("href")!), a.getAttribute("href")!).toBe(false);
    for (const id of ["investing", "service-provider"]) {
      const d = doors().find((x) => x.dataset.kind === id)!;
      expect(d.querySelector('[data-row="resources"] a')?.getAttribute("href"), id).toBe(WAYS_IN.canvas);
    }
  });

  it("shows the Communitas portrait only with its disclosure line", () => {
    const disclosure = dwarves.find((d) => d.id === "communitas")!.disclosure;
    const portrait = band.querySelector('img[alt*="Communitas"], [data-keeper="communitas"]');
    if (portrait) {
      expect(portrait.getAttribute("alt") ?? "").toMatch(/AI agent/);
      expect(text(band)).toContain(disclosure);
    } else {
      expect(text(band)).not.toMatch(/Communitas/);
    }
  });

  it("keeps to the site's words: no em dash, spaced en dash, Outpost, HQ or Hall", () => {
    expect(text(band)).not.toMatch(/—| – |\bOutpost\b|\bHQ\b|\bHall\b/);
  });

  it("needs no JavaScript inside the band: no inline script or handler", () => {
    for (const s of band.querySelectorAll("script")) expect(s.getAttribute("src"), "an inline script").toBeTruthy();
    expect(band.outerHTML).not.toMatch(/\son[a-z]+=/i);
  });

  it("passes axe (structure and ARIA; color contrast runs in the browser e2e)", async () => {
    const results = await axe.run(band, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
