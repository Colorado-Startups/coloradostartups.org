// @vitest-environment jsdom
// Step L1b: Startup Resources opens on its picks, and the full list waits
// behind "Show all N resources". A URL with a filter, a search or an anchor
// into the list opens on the list, as the page did before.
import { beforeEach, describe, expect, it } from "vitest";

import { initCanvasFilters } from "../../../src/components/canvas/canvas-filters";
import { opensOnList } from "../../../src/components/canvas/filter-logic";

const card = (id: string, stage: string) =>
  `<li data-resource data-id="${id}" data-stage="${stage}" data-type="event" data-city="Denver"><h3 id="r-${id}"><a href="https://x.example/${id}">${id}</a></h3></li>`;

const PAGE = `
<div data-canvas-root>
  <section data-canvas-picks><ul><li data-pick data-id="a"><a href="https://x.example/a">a</a></li></ul></section>
  <p data-canvas-show-row><button type="button" aria-expanded="false" aria-controls="all-resources" data-canvas-show-all>Show all 2 resources</button></p>
  <div id="all-resources" data-canvas-full hidden>
    <form data-canvas-filters>
      <input name="q" />
      <label><input type="radio" name="stage" value="idea" /></label><label><input type="radio" name="stage" value="launch" /></label><label><input type="radio" name="stage" value="" checked /></label>
      <label><input type="radio" name="type" value="" checked /></label><label><input type="radio" name="type" value="event" /></label>
      <select name="city"><option value=""></option><option value="Denver"></option></select>
    </form>
    <p data-canvas-count></p>
    <section id="idea" data-canvas-group><ul>${card("a", "idea")}</ul></section>
    <section id="launch" data-canvas-group><ul>${card("b", "launch")}</ul></section>
  </div>
</div>`;

const root = () => document.querySelector<HTMLElement>("[data-canvas-root]")!;
const full = () => document.querySelector<HTMLElement>("[data-canvas-full]")!;
const button = () => document.querySelector<HTMLButtonElement>("[data-canvas-show-all]")!;
const row = () => document.querySelector<HTMLElement>("[data-canvas-show-row]")!;

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

  it("opens the list on click and puts focus in its search box", async () => {
    await initCanvasFilters(root(), async () => null).apply();
    button().click();
    expect(full().hidden).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(row().hidden).toBe(true);
    expect(document.activeElement?.getAttribute("name")).toBe("q");
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
    window.history.replaceState(null, "", "/ecosystem-canvas/#r-b");
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
