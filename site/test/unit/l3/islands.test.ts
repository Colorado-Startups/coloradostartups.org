// @vitest-environment jsdom
// L3's two islands in jsdom: the directory filter and the suggest-form helper.
// Pagefind is replaced by a fake, so these run without a build.
import { beforeEach, describe, expect, it } from "vitest";

import { initCanvasFilters } from "../../../src/components/canvas/canvas-filters";
import { countText, grounds, groupCountText, idsFromSubResults, matches, readState, writeState } from "../../../src/components/canvas/filter-logic";
import { ERROR_MESSAGES, initSuggestForm } from "../../../src/components/canvas/suggest-form";

const card = (id: string, stage: string, type: string, city: string, text: string) =>
  `<li data-resource data-id="${id}" data-stage="${stage}" data-type="${type}" data-city="${city}"><h4 id="r-${id}">${text}</h4></li>`;

const PAGE = `
<div data-canvas-root>
  <form data-canvas-filters hidden>
    <input name="q" />
    <select name="stage"><option value=""></option><option value="idea"></option><option value="launch"></option></select>
    <select name="type"><option value=""></option><option value="event"></option><option value="investor"></option></select>
    <select name="city"><option value=""></option><option value="Denver"></option><option value="Boulder"></option></select>
  </form>
  <p data-canvas-count></p>
  <section id="idea" data-canvas-group><ul>
    ${card("ignite", "idea", "event", "Boulder", "Ignite Boulder, open startup gathering")}
  </ul></section>
  <section id="launch" data-canvas-group><ul>
    ${card("angels", "launch", "investor", "Denver", "Denver Angels, angel investor group")}
    ${card("seedco", "launch", "investor", "Boulder", "Seed Co, seed venture firm")}
  </ul><p data-canvas-back hidden><a href="#find-title">Back to filters</a></p></section>
  <section id="support" data-canvas-group><ul>
    ${card("sbdc", "support", "government", "Denver", "Denver SBDC, free business advising")}
  </ul></section>
</div>`;

const shown = () => [...document.querySelectorAll<HTMLElement>("[data-resource]")].filter((e) => !e.hidden).map((e) => e.dataset.id);
const root = () => document.querySelector<HTMLElement>("[data-canvas-root]")!;

describe("filter logic", () => {
  const allowed = { stage: new Set(["idea"]), type: new Set(["event"]), city: new Set(["Denver"]) };

  it("reads only allowed values from the URL and writes empty ones out", () => {
    expect(readState("?stage=idea&type=bogus&city=Denver&q=x", allowed)).toEqual({ stage: "idea", type: "", city: "Denver", q: "x" });
    expect(writeState({ stage: "idea", type: "", city: "", q: "law firm" })).toBe("?stage=idea&q=law+firm");
    expect(writeState({ stage: "", type: "", city: "", q: "" })).toBe("");
  });

  it("matches every word of a query when Pagefind is not there", () => {
    const facts = { id: "a", stage: "idea", type: "event", city: "Boulder", text: "Ignite Boulder, open gathering" };
    const state = { stage: "", type: "", city: "", q: "ignite boulder" };
    expect(matches(facts, state, null)).toBe(true);
    expect(matches(facts, { ...state, q: "ignite denver" }, null)).toBe(false);
    expect(matches(facts, state, new Set(["b"]))).toBe(false);
  });

  it("shows Support under every chosen stage, and only Support under Support (#134)", () => {
    const at = (stage: string) => ({ id: stage, stage, type: "event", city: "Denver", text: "" });
    const pick = (stage: string) => ({ stage, type: "", city: "", q: "" });
    for (const stage of ["idea", "launch", "growth"]) expect(matches(at("support"), pick(stage), null)).toBe(true);
    expect(matches(at("idea"), pick("launch"), null)).toBe(false);
    expect(matches(at("support"), pick("support"), null)).toBe(true);
    expect(matches(at("launch"), pick("support"), null)).toBe(false);
    // The other filters still apply to a Support card.
    expect(matches(at("support"), { ...pick("launch"), city: "Boulder" }, null)).toBe(false);
  });

  it("deals band and lit grounds over the sections still showing (#310)", () => {
    expect(grounds([true, true, true, true], "band")).toEqual(["band", "lit", "band", "lit"]);
    expect(grounds([true, false, true, true], "band")).toEqual(["band", null, "lit", "band"]);
    expect(grounds([false, true, true], "lit")).toEqual([null, "lit", "band"]);
  });

  it("keeps only sub-results on this page", () => {
    const ids = idsFromSubResults(["/ecosystem-canvas/#r-a", "/team/#r-b", "/ecosystem-canvas/", "https://x.example/ecosystem-canvas/#r-c"], "/ecosystem-canvas/");
    expect([...ids]).toEqual(["r-a", "r-c"]);
  });

  it("says how many it shows", () => {
    expect(countText(3, 3)).toBe("Showing all 3 resources.");
    expect(countText(1, 3)).toBe("Showing 1 of 3 resources.");
    expect(groupCountText(1)).toBe("1 resource");
    expect(groupCountText(12)).toBe("12 resources");
  });
});

describe("initCanvasFilters", () => {
  beforeEach(() => {
    document.body.innerHTML = PAGE;
    window.history.replaceState(null, "", "/ecosystem-canvas/");
  });

  it("reveals the form and shows everything at first", async () => {
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(document.querySelector<HTMLFormElement>("form")!.hidden).toBe(false);
    expect(shown()).toEqual(["ignite", "angels", "seedco", "sbdc"]);
    expect(document.querySelector("[data-canvas-count]")!.textContent).toBe("Showing all 4 resources.");
  });

  it("reveals the Back to filters links with the form, and hides them with their stage (#143)", async () => {
    const back = document.querySelector<HTMLElement>("[data-canvas-back]")!;
    expect(back.hidden).toBe(true);
    window.history.replaceState(null, "", "/ecosystem-canvas/?stage=idea");
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(back.hidden).toBe(false);
    // Launch has no Idea card, so its section, back link and all, is hidden.
    expect(back.closest<HTMLElement>("section")!.hidden).toBe(true);
  });

  it("applies filters from the URL, hides empty sections and keeps the URL in step", async () => {
    window.history.replaceState(null, "", "/ecosystem-canvas/?type=investor&city=Boulder");
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(shown()).toEqual(["seedco"]);
    expect(document.querySelector<HTMLElement>("#idea")!.hidden).toBe(true);
    expect(window.location.search).toBe("?type=investor&city=Boulder");
  });

  it("keeps the stage anchor in the URL", async () => {
    window.history.replaceState(null, "", "/ecosystem-canvas/?stage=launch#launch");
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(window.location.hash).toBe("#launch");
    expect(window.location.search).toBe("?stage=launch");
  });

  it("shows the Support group after the chosen stage (#134)", async () => {
    window.history.replaceState(null, "", "/ecosystem-canvas/?stage=launch");
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(shown()).toEqual(["angels", "seedco", "sbdc"]);
    expect(document.querySelector<HTMLElement>("#idea")!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("#support")!.hidden).toBe(false);
    expect(document.querySelector("[data-canvas-count]")!.textContent).toBe("Showing 3 of 4 resources.");
  });

  it("uses the search hook's ids for a text query", async () => {
    window.history.replaceState(null, "", "/ecosystem-canvas/?q=money");
    const seen: string[] = [];
    const { apply } = initCanvasFilters(root(), async (q) => {
      seen.push(q);
      return new Set(["angels"]);
    });
    await apply();
    expect(seen).toContain("money");
    expect(shown()).toEqual(["angels"]);
  });

  it("falls back to the cards' own text when search is unavailable", async () => {
    window.history.replaceState(null, "", "/ecosystem-canvas/?q=seed%20venture");
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(shown()).toEqual(["seedco"]);
  });

  it("alternates the section grounds among the sections a filter leaves showing (#310)", async () => {
    // The page's order: the find band, four stage sections, then "Missing something?".
    const stage = (id: string, ground: string, cardStage: string) =>
      `<section id="${id}" class="section section--${ground}" data-canvas-group><ul>${card(id + "-1", cardStage, "event", "Denver", id)}</ul></section>`;
    document.body.innerHTML = `
<div data-canvas-root>
  <section id="find" class="section section--band">
    <form data-canvas-filters hidden>
      <input name="q" />
      <select name="stage"><option value=""></option><option value="idea"></option><option value="launch"></option><option value="growth"></option><option value="support"></option></select>
      <select name="type"><option value=""></option></select>
      <select name="city"><option value=""></option></select>
    </form>
    <p data-canvas-count></p>
  </section>
  ${stage("idea", "lit", "idea")}
  ${stage("launch", "band", "launch")}
  ${stage("growth", "lit", "growth")}
  ${stage("support", "band", "support")}
  <section id="missing" class="section section--lit"></section>
</div>`;
    const ground = (id: string) => {
      const list = document.getElementById(id)!.classList;
      return [list.contains("section--band") && "band", list.contains("section--lit") && "lit"].filter(Boolean).join("+");
    };
    const shownGrounds = () =>
      [...document.querySelectorAll<HTMLElement>("[data-canvas-root] > section")].filter((s) => !s.hidden).map((s) => `${s.id}:${ground(s.id)}`);

    window.history.replaceState(null, "", "/ecosystem-canvas/?stage=launch");
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(shownGrounds()).toEqual(["find:band", "launch:lit", "support:band", "missing:lit"]);

    const select = document.querySelector<HTMLSelectElement>("select[name=stage]")!;
    select.value = "support";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await apply();
    expect(shownGrounds()).toEqual(["find:band", "support:lit", "missing:band"]);

    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await apply();
    expect(shownGrounds()).toEqual(["find:band", "idea:lit", "launch:band", "growth:lit", "support:band", "missing:lit"]);
  });

  it("keeps each substage's count badge in step with the filters (#220)", async () => {
    // A substage with its count badge, as ecosystem-canvas/index.astro renders it.
    document.body.innerHTML = `
<div data-canvas-root>
  <form data-canvas-filters hidden>
    <input name="q" />
    <select name="stage"><option value=""></option></select>
    <select name="type"><option value=""></option></select>
    <select name="city"><option value=""></option><option value="Denver"></option><option value="Boulder"></option></select>
  </form>
  <p data-canvas-count></p>
  <section id="launch" data-canvas-group><div data-canvas-group>
    <h3>Investors</h3><span data-group-count>2 resources</span>
    <ul>
      ${card("angels", "launch", "investor", "Denver", "Denver Angels, angel investor group")}
      ${card("seedco", "launch", "investor", "Boulder", "Seed Co, seed venture firm")}
    </ul>
  </div></section>
</div>`;
    window.history.replaceState(null, "", "/ecosystem-canvas/?city=Boulder");
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    const badge = () => document.querySelector("[data-group-count]")!.textContent;
    expect(badge()).toBe("1 resource");
    const city = document.querySelector<HTMLSelectElement>("select[name=city]")!;
    city.value = "";
    city.dispatchEvent(new Event("change", { bubbles: true }));
    await apply();
    expect(badge()).toBe("2 resources");
  });
});

describe("initSuggestForm", () => {
  beforeEach(() => {
    document.body.innerHTML = `<form><p data-form-error hidden></p><input type="hidden" name="ts" value="" /></form>`;
  });
  const form = () => document.querySelector<HTMLFormElement>("form")!;
  const box = () => document.querySelector<HTMLElement>("[data-form-error]")!;

  it("stamps the load time for the Worker's speed check", () => {
    initSuggestForm(form(), "", () => 1_800_000_000_000);
    expect((form().elements.namedItem("ts") as HTMLInputElement).value).toBe("1800000000000");
  });

  it("shows the message for every error code the Worker sends", () => {
    for (const code of ["invalid", "verification", "ratelimit", "delivery", "unavailable"]) {
      document.body.innerHTML = `<form><p data-form-error hidden></p></form>`;
      initSuggestForm(form(), `?error=${code}`);
      expect(box().hidden).toBe(false);
      expect(box().textContent).toBe(ERROR_MESSAGES[code]);
    }
  });

  it("ignores an unknown code and never renders the URL as HTML", () => {
    initSuggestForm(form(), "?error=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");
    expect(box().hidden).toBe(true);
    expect(box().innerHTML).toBe("");
  });
});
