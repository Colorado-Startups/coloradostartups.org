// @vitest-environment jsdom
// Step L1b: Startup Resources opens on its picks, and the full list waits
// behind "Show all N resources". The search box sits above the picks and
// joins the filter form through form="canvas-filters"; typing in it opens
// the list. A URL with a filter, a search or an anchor into the list opens on
// the list, as the page did before.
import { beforeEach, describe, expect, it } from "vitest";

import { initCanvasFilters } from "../../../src/components/canvas/canvas-filters";
import { opensOnList } from "../../../src/components/canvas/filter-logic";

const card = (id: string, stage: string) =>
  `<li data-resource data-id="${id}" data-stage="${stage}" data-type="event" data-city="Denver"><h3 id="r-${id}"><a href="https://x.example/${id}">${id}</a></h3></li>`;

const PAGE = `
<div data-canvas-root>
  <div data-canvas-search><input id="canvas-q" name="q" form="canvas-filters" /></div>
  <section data-canvas-picks><ul><li data-pick data-id="alpha"><a href="https://x.example/alpha">alpha</a></li></ul></section>
  <p data-canvas-show-row><button type="button" aria-expanded="false" aria-controls="all-resources" data-canvas-show-all>Show all 2 resources</button></p>
  <div id="all-resources" data-canvas-full hidden>
    <h2 id="find-title" tabindex="-1">Find a resource</h2>
    <form id="canvas-filters" data-canvas-filters>
      <label><input type="radio" name="stage" value="idea" /></label><label><input type="radio" name="stage" value="launch" /></label><label><input type="radio" name="stage" value="" checked /></label>
      <label><input type="radio" name="type" value="" checked /></label><label><input type="radio" name="type" value="event" /></label>
      <select name="city"><option value=""></option><option value="Denver"></option></select>
    </form>
    <p data-canvas-count></p>
    <section id="idea" data-canvas-group><ul>${card("alpha", "idea")}</ul></section>
    <section id="launch" data-canvas-group><ul>${card("bravo", "launch")}</ul></section>
  </div>
</div>`;

const root = () => document.querySelector<HTMLElement>("[data-canvas-root]")!;
const full = () => document.querySelector<HTMLElement>("[data-canvas-full]")!;
const button = () => document.querySelector<HTMLButtonElement>("[data-canvas-show-all]")!;
const row = () => document.querySelector<HTMLElement>("[data-canvas-show-row]")!;
const picks = () => document.querySelector<HTMLElement>("[data-canvas-picks]")!;
const shown = () => [...document.querySelectorAll<HTMLElement>("[data-resource]")].filter((e) => !e.hidden).map((e) => e.dataset.id);
const settle = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("opensOnList", () => {
  it("is true for any filter, search or region parameter with a value", () => {
    for (const q of ["?stage=idea", "?type=event", "?city=Denver", "?q=law", "?region=fusion-canyon", "?utm_source=x&q=a"]) {
      expect(opensOnList(q), q).toBe(true);
    }
  });

  it("is false for no parameters, empty ones, or ones that do not filter", () => {
    for (const q of ["", "?", "?q=", "?q=%20", "?stage=", "?utm_source=newsletter"]) expect(opensOnList(q), q).toBe(false);
  });
});

describe("the Show all control", () => {
  beforeEach(() => {
    document.body.innerHTML = PAGE;
    window.history.replaceState(null, "", "/ecosystem-canvas/");
  });

  it("keeps the list closed on a plain URL", async () => {
    await initCanvasFilters(root(), async () => null).apply();
    expect(full().hidden).toBe(true);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(row().hidden).toBe(false);
  });

  it("opens the list on click and moves focus to its heading", async () => {
    await initCanvasFilters(root(), async () => null).apply();
    button().click();
    expect(full().hidden).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(row().hidden).toBe(true);
    expect(document.activeElement?.id).toBe("find-title");
    expect(picks().hidden).toBe(false);
  });

  it("opens and filters the list when the visitor types in the search box above the picks", async () => {
    await initCanvasFilters(root(), async () => null).apply();
    const q = document.querySelector<HTMLInputElement>("#canvas-q")!;
    expect(q.form?.id).toBe("canvas-filters");
    q.value = "bravo";
    q.dispatchEvent(new Event("input", { bubbles: true }));
    await settle(250);
    expect(full().hidden).toBe(false);
    expect(picks().hidden).toBe(true);
    expect(shown()).toEqual(["bravo"]);
    expect(window.location.search).toBe("?q=bravo");
    q.value = "";
    q.dispatchEvent(new Event("input", { bubbles: true }));
    await settle(250);
    expect(picks().hidden).toBe(false);
    expect(full().hidden).toBe(false);
  });

  it("opens on the list when the URL carries a filter or a search", async () => {
    for (const search of ["?stage=launch", "?q=b", "?region=fusion-canyon"]) {
      document.body.innerHTML = PAGE;
      window.history.replaceState(null, "", `/ecosystem-canvas/${search}`);
      await initCanvasFilters(root(), async () => null).apply();
      expect(full().hidden, search).toBe(false);
      expect(row().hidden, search).toBe(true);
    }
  });

  it("opens on the list for a stage or resource anchor, and on a later hash change", async () => {
    window.history.replaceState(null, "", "/ecosystem-canvas/#r-bravo");
    await initCanvasFilters(root(), async () => null).apply();
    expect(full().hidden).toBe(false);

    document.body.innerHTML = PAGE;
    window.history.replaceState(null, "", "/ecosystem-canvas/");
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(full().hidden).toBe(true);
    window.location.hash = "#launch";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await apply();
    expect(full().hidden).toBe(false);
  });
});
