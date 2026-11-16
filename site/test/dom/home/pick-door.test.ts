// Step P4 over the built site (run `npm run build` first; test:content does):
// the "Pick your door" band on home. It must work with no JavaScript, so
// these tests read the static markup and never run a script. Its word counts
// (60 on screen, 30 behind each door) are in home-budget.test.ts too.
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
const threads = parse(readFileSync(path.join(DATA, "communitas/threads.yaml"), "utf8")) as { title: string }[];
const dwarves = parse(readFileSync(path.join(DATA, "team/dwarves.yaml"), "utf8")) as { id: string; disclosure: string }[];

const resources = readdirSync(path.join(DATA, "resources"), { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".yaml"))
  .map(
    (f) =>
      parse(readFileSync(path.join(DATA, "resources", f), "utf8")) as {
        id: string;
        url?: string;
        type: string;
        substage: string;
        status: string;
      },
  );
const byId = new Map(resources.map((r) => [r.id, r]));
const commercialUrls = new Set(
  resources.filter((r) => isCommercial(r as Parameters<typeof isCommercial>[0])).map((r) => r.url).filter(Boolean),
);

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

// Words as home-budget.test.ts counts them: text nodes joined with a space.
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.,:/-]*/gu;
function words(root: Element): string[] {
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === child.TEXT_NODE) parts.push(child.textContent ?? "");
      else if (child.nodeType === child.ELEMENT_NODE && !(child as Element).matches("svg, [hidden], .visually-hidden")) walk(child);
    }
  };
  walk(root);
  return parts.join(" ").match(WORD) ?? [];
}

let home: Document;
let band: HTMLElement;
let canvasIds: Set<string>;

beforeAll(() => {
  home = new DOMParser().parseFromString(readDist("index.html"), "text/html");
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

  it("opens each door to its weekly Slack thread, by name, with a Join the Slack link", () => {
    const titles = new Set(threads.map((t) => t.title));
    for (const d of doors()) {
      const kind = d.dataset.kind;
      const row = d.querySelector('[data-row="slack"]')!;
      const line = text(row.querySelector("p"));
      expect(line, kind).toMatch(/^(.+) thread, weekly in the Slack\.$/);
      expect(titles.has(line.replace(/ thread, weekly in the Slack\.$/, "")), line).toBe(true);
      const join = row.querySelector("a[data-join]")!;
      expect(text(join), kind).toBe("Join the Slack");
      expect(join.getAttribute("href"), kind).toBe(WAYS_IN.slack);
    }
  });

  it("describes every Join the Slack link by the hero's note that it opens a Google Form", () => {
    const joins = [...band.querySelectorAll("a[data-join]")];
    expect(joins.length).toBe(doors().length);
    for (const join of joins) {
      const note = home.getElementById(join.getAttribute("aria-describedby") ?? "");
      expect(text(note)).toBe("Join the Slack opens a Google Form.");
    }
  });

  it("names the stage's picks behind a door with a stage, then links all of them; other doors link Startup Resources", () => {
    for (const d of doors()) {
      const kind = d.dataset.kind;
      const all = d.querySelector('[data-row="resources"] a[data-all]')!;
      const picks = [...d.querySelectorAll('[data-row="resources"] a[data-pick]')];
      expect(picks.length, kind).toBeLessThanOrEqual(3);
      if (all.hasAttribute("data-stage")) {
        expect(picks.length, kind).toBeGreaterThan(0);
        expect(text(all), kind).toMatch(/^All (Idea|Launch|Growth|Support) picks$/);
      } else {
        expect(picks, kind).toEqual([]);
        expect(text(all), kind).toBe("Startup Resources");
        expect(all.getAttribute("href"), kind).toBe(WAYS_IN.canvas);
      }
    }
  });

  it("names only non-commercial picks, each linking its real, active card on Startup Resources", () => {
    const named = [...band.querySelectorAll("a[data-pick]")];
    expect(named.length, "named picks").toBeGreaterThan(0);
    for (const a of named) {
      const id = a.getAttribute("data-pick")!;
      const r = byId.get(id);
      expect(r, id).toBeTruthy();
      expect(r!.status, id).toBe("active");
      expect(isCommercial(r as Parameters<typeof isCommercial>[0]), id).toBe(false);
      expect(a.getAttribute("href"), id).toBe(`${WAYS_IN.canvas}#r-${id}`);
      expect(canvasIds.has(`r-${id}`), id).toBe(true);
    }
  });

  it("holds at most 30 words behind each door", () => {
    for (const d of doors()) {
      const body = [...d.children].filter((c) => !c.matches("summary")).flatMap(words);
      expect(body.length, d.dataset.kind).toBeGreaterThan(0);
      expect(body.length, d.dataset.kind).toBeLessThanOrEqual(30);
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
      const link = shown[0]!.querySelector("a")!;
      expect(link.getAttribute("href")).toBe(WAYS_IN.events);
      // A cut title keeps its full text for assistive tech, with the date.
      const label = link.getAttribute("aria-label") ?? "";
      expect(label.startsWith(text(link).replace(/…$/, ""))).toBe(true);
      expect(label).toContain(text(shown[0]!.querySelector("time")));
    } else {
      expect(empty.hasAttribute("hidden")).toBe(false);
      expect(empty.querySelector("a")?.getAttribute("href")).toBe(WAYS_IN.events);
    }
  });

  it("links only to WAYS_IN, or to a stage's picks that exist on Startup Resources", () => {
    const ways = new Set(Object.values(WAYS_IN));
    for (const a of band.querySelectorAll("a")) {
      const href = a.getAttribute("href")!;
      if (href.startsWith(`${WAYS_IN.canvas}#`)) expect(canvasIds.has(href.split("#")[1]!), href).toBe(true);
      else expect(ways.has(href), href).toBe(true);
    }
  });

  it("lists no commercial resource (picks are for founders)", () => {
    for (const a of band.querySelectorAll("a")) expect(commercialUrls.has(a.getAttribute("href")!), a.getAttribute("href")!).toBe(false);
    for (const id of ["investing", "service-provider"]) {
      const d = doors().find((x) => x.dataset.kind === id)!;
      expect(d.querySelectorAll("a[data-pick]").length, id).toBe(0);
      expect(d.querySelector('[data-row="resources"] a[data-all]')?.getAttribute("href"), id).toBe(WAYS_IN.canvas);
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
