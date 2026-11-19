// Step W8 over the built site (run `npm run build` first; test:content does).
// With no script, every page's header offers "Pick your region" as a link to
// /regions/. The chooser lists every region once, as equals. With no pick,
// the island shows the Pick your region button, and home's This week keeps
// the order the build wrote. The islands' own rules are in
// test/unit/your-region.test.ts.
import { REGION_IDS } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { initRegionFirst } from "../../../src/components/events/this-week";
import { initRegionSlot } from "../../../src/components/ui/header/region-slot";
import { REGIONS } from "../../../src/lib/regions/match";
import { type RegionStore, YOUR_REGION_KEY } from "../../../src/lib/your-region";
import { contentPages, readDist } from "../pages";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

function memory(seed: Record<string, string> = {}): RegionStore {
  const data = new Map(Object.entries(seed));
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe("the header's region slot with no script", () => {
  it("is on every page with the header, once, offering Pick your region as a link to /regions/", { timeout: 120_000 }, () => {
    const missing: string[] = [];
    for (const page of contentPages()) {
      if (!page.html.includes('class="site-header')) continue;
      const slots = page.html.match(/data-your-region[\s>]/g) ?? [];
      if (slots.length !== 1) missing.push(`${page.route}: ${slots.length} slots`);
    }
    expect(missing).toEqual([]);
  });

  for (const route of ["index.html", "regions/index.html", "privacy/index.html", "404.html"]) {
    it(`${route}: shows the link, and keeps the button and the picked state hidden`, () => {
      const slot = parse(readDist(route)).querySelector<HTMLElement>(".site-header [data-your-region]")!;
      const link = slot.querySelector<HTMLAnchorElement>("a[data-region-link]")!;
      expect(link.getAttribute("href")).toBe("/regions/");
      expect(link.hidden).toBe(false);
      expect(text(link)).toBe("Pick your region");
      expect(slot.querySelector<HTMLElement>("button[data-region-open]")!.hidden).toBe(true);
      expect(slot.querySelector<HTMLElement>("[data-region-mine]")!.hidden).toBe(true);
      // No crest is fetched until a visitor picks or opens the chooser.
      expect(slot.querySelectorAll("img")).toHaveLength(0);
    });
  }
});

describe("the chooser", () => {
  const home = parse(readDist("index.html"));
  const slot = home.querySelector<HTMLElement>(".site-header [data-your-region]")!;
  const template = slot.querySelector<HTMLTemplateElement>("template[data-region-template]")!;
  const choices = [...template.content.querySelectorAll<HTMLButtonElement>("button[data-region-pick]")];

  it("validates against the real region ids", () => {
    expect(slot.dataset.regionIds?.split(" ")).toEqual([...REGION_IDS]);
  });

  it("lists every region once, A to Z by name, each linking its own page", () => {
    const ids = choices.map((b) => b.dataset.regionPick);
    expect([...ids].sort()).toEqual([...REGION_IDS].sort());
    expect(new Set(ids).size).toBe(REGION_IDS.length);
    const names = choices.map((b) => text(b.querySelector("[data-region-name]")));
    expect(names).toEqual(REGIONS.map((r) => r.name).sort((a, b) => a.localeCompare(b, "en")));
    for (const b of choices) expect(b.dataset.regionHref).toBe(`/regions/${b.dataset.regionPick}/`);
  });

  it("gives every region the same button: crest, name and core cities, none ranked", () => {
    const shape = (b: HTMLButtonElement) => [b.className, [...b.children].map((c) => c.className).join(" ")].join(" | ");
    expect(new Set(choices.map(shape)).size).toBe(1);
    for (const b of choices) {
      const region = REGIONS.find((r) => r.id === b.dataset.regionPick)!;
      expect(b.getAttribute("aria-pressed")).toBe("false");
      expect(b.querySelector("img")?.getAttribute("loading")).toBe("lazy");
      for (const city of region.cities) expect(text(b)).toContain(city);
      expect(text(b)).not.toMatch(/\b(?:Outpost|HQ|Hall)\b|#\d|\b(?:first|top|best)\b/i);
    }
  });

  it("is a dialog named by its heading, with a Close button and a hidden Forget my region", () => {
    const dialog = template.content.querySelector("dialog")!;
    const title = template.content.getElementById(dialog.getAttribute("aria-labelledby") ?? "");
    expect(text(title)).toBe("Pick your region");
    expect(text(dialog.querySelector("form[method='dialog'] button"))).toBe("Close");
    const forget = dialog.querySelector<HTMLElement>("[data-region-forget-row]")!;
    expect(forget.hidden).toBe(true);
    expect(text(forget.querySelector("button"))).toBe("Forget my region");
  });

  it("ships two notes: the device keeps the pick, or it lasts for this page, the second hidden", () => {
    const notes = [...template.content.querySelectorAll<HTMLElement>("[data-region-note]")];
    expect(notes.map((n) => [n.dataset.regionNote, n.hidden])).toEqual([
      ["kept", false],
      ["view", true],
    ]);
    expect(text(notes[0])).toContain("keeps your pick on this device");
    expect(text(notes[1])).toContain("until you leave this page");
    for (const n of notes) expect(text(n)).toContain("It is never sent to us.");
  });

  it("with no pick, the island shows the Pick your region button", () => {
    const page = parse(readDist("index.html"));
    const live = page.querySelector<HTMLElement>(".site-header [data-your-region]")!;
    initRegionSlot(live, memory());
    expect(live.querySelector<HTMLElement>("a[data-region-link]")!.hidden).toBe(true);
    const button = live.querySelector<HTMLButtonElement>("button[data-region-open]")!;
    expect(button.hidden).toBe(false);
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(text(button)).toBe("Pick your region");
    expect(live.querySelector<HTMLElement>("[data-region-mine]")!.hidden).toBe(true);
  });
});

describe("This week on home", () => {
  const strip = (doc: Document) => doc.querySelector<HTMLElement>('section[aria-labelledby="this-week"] [data-this-week]')!;
  const order = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("li[data-starts]")].map((li) => li.dataset.starts);

  it("ships the region line hidden, and region pages have none", () => {
    expect(strip(parse(readDist("index.html"))).querySelector<HTMLElement>("[data-region-first]")!.hidden).toBe(true);
    for (const id of REGION_IDS) {
      expect(parse(readDist(`regions/${id}/index.html`)).querySelector("[data-region-first]"), id).toBeNull();
    }
  });

  it("keeps its current order with no pick", () => {
    const root = strip(parse(readDist("index.html")));
    const built = order(root);
    initRegionFirst(root, memory());
    expect(order(root)).toEqual(built);
    expect(root.querySelector<HTMLElement>("[data-region-first]")!.hidden).toBe(true);
  });

  // The built strip, with its events swapped for a fixture: one event in each
  // region, the picked one last. So this asserts whatever the build's event
  // snapshot holds, even no event at all.
  for (const { id, name } of REGIONS) {
    it(`with ${id} picked, puts its event first and says so`, () => {
      const root = strip(parse(readDist("index.html")));
      const doc = root.ownerDocument;
      const list = root.querySelector("ol") ?? root.insertBefore(doc.createElement("ol"), root.firstChild);
      const day = 86_400_000;
      const soon = Date.now() + day;
      const order = [...REGIONS.filter((r) => r.id !== id), { id }].map((r) => r.id);
      list.replaceChildren(
        ...order.map((region, i) => {
          const li = doc.createElement("li");
          li.dataset.starts = new Date(soon + i * day).toISOString();
          li.dataset.ends = new Date(soon + i * day + 3_600_000).toISOString();
          li.dataset.eventRegion = region;
          li.hidden = i >= Number(root.dataset.count);
          li.innerHTML = `<time data-countdown>soon</time><a href="/event-calendar/">Event in ${region}</a>`;
          return li;
        }),
      );
      initRegionFirst(root, memory({ [YOUR_REGION_KEY]: id }));
      const first = root.querySelector<HTMLElement>("li[data-starts]:not([hidden])")!;
      expect(first.dataset.eventRegion).toBe(id);
      const line = root.querySelector<HTMLElement>("[data-region-first]")!;
      expect(line.hidden).toBe(false);
      expect(text(line)).toBe(`Showing ${name} first. Show all`);
    });
  }
});
