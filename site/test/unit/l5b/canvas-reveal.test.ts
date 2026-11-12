// @vitest-environment jsdom
// L5b (#724): on a phone, a menu change on Startup Resources brings the stage
// holding the first result into view. The search box, wide screens and a
// result already in the upper part of the screen never scroll.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initCanvasFilters } from "../../../src/components/canvas/canvas-filters";

const card = (id: string, stage: string, city: string) =>
  `<li data-resource data-id="${id}" data-stage="${stage}" data-type="event" data-city="${city}"><h4>${id}</h4></li>`;

const PAGE = `
<div data-canvas-root>
  <form data-canvas-filters hidden>
    <input name="q" />
    <select name="stage"><option value=""></option><option value="idea"></option><option value="launch"></option></select>
    <select name="type"><option value=""></option><option value="event"></option></select>
    <select name="city"><option value=""></option><option value="Denver"></option><option value="Boulder"></option></select>
  </form>
  <p data-canvas-count></p>
  <section id="idea" data-canvas-group><ul>${card("a", "idea", "Boulder")}</ul></section>
  <section id="launch" data-canvas-group><ul>${card("b", "launch", "Denver")}</ul></section>
</div>`;

let narrow = true;
let top = 900;
const scrolled: string[] = [];

beforeEach(() => {
  document.body.innerHTML = PAGE;
  narrow = true;
  top = 900;
  scrolled.length = 0;
  window.history.replaceState(null, "", "/ecosystem-canvas/");
  Object.defineProperty(window, "innerHeight", { value: 812, configurable: true });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width") ? narrow : false }));
  for (const s of document.querySelectorAll<HTMLElement>("section")) {
    s.getBoundingClientRect = () => ({ top }) as DOMRect;
    s.scrollIntoView = () => void scrolled.push(s.id);
  }
});
afterEach(() => vi.unstubAllGlobals());

const root = () => document.querySelector<HTMLElement>("[data-canvas-root]")!;
async function pick(name: string, value: string) {
  const { apply } = initCanvasFilters(root(), async () => null);
  await apply();
  scrolled.length = 0;
  const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
  control.value = value;
  control.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
}

describe("a menu change on a phone", () => {
  it("scrolls the stage of the first result into view", async () => {
    await pick("city", "Denver");
    expect(scrolled).toEqual(["launch"]);
  });

  it("leaves the page still for the search box, a wide screen, or a result already in view", async () => {
    await pick("q", "a");
    expect(scrolled).toEqual([]);
    narrow = false;
    await pick("city", "Denver");
    expect(scrolled).toEqual([]);
    narrow = true;
    top = 200;
    await pick("city", "Denver");
    expect(scrolled).toEqual([]);
  });
});
