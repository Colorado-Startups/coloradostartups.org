// @vitest-environment jsdom
// L3's two islands in jsdom: the directory filter and the suggest-form helper.
// Pagefind is replaced by a fake, so these run without a build.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initCanvasFilters } from "../../../src/components/canvas/canvas-filters";
import {
  countText,
  groupCountText,
  idsFromSubResults,
  limitFor,
  matches,
  moreText,
  PAGE_SIZE,
  pageOf,
  readState,
  shownText,
  stageCounts,
  writeState,
} from "../../../src/components/canvas/filter-logic";
import { ERROR_MESSAGES, initSuggestForm } from "../../../src/components/canvas/suggest-form";

const card = (id: string, stage: string, type: string, city: string, text: string) =>
  `<li data-resource data-id="${id}" data-stage="${stage}" data-type="${type}" data-city="${city}"><h3 id="r-${id}"><a href="https://x.example/${id}">${text}</a></h3></li>`;

// The page as ecosystem-canvas/index.astro renders it (step F): radio chips
// for stage and type, a city menu, stage sections, then the "Show more" row
// and the "Back to filters" link after the last stage.
const radios = (name: string, values: string[]) =>
  values.map((v) => `<label><input type="radio" name="${name}" value="${v}"${v === "" ? " checked" : ""} /></label>`).join("");
const form = (stages = ["idea", "launch", "growth", "support"], types = ["event", "investor", "government"]) => `
  <form data-canvas-filters>
    <input name="q" />
    ${radios("stage", [...stages, ""])}
    ${radios("type", ["", ...types])}
    <select name="city"><option value=""></option><option value="Denver"></option><option value="Boulder"></option></select>
  </form>
  <span data-stage-count="idea"></span><span data-stage-count="launch"></span><span data-stage-count="support"></span><span data-stage-count=""></span>
  <p data-canvas-count tabindex="-1"></p>`;
const tail = `
  <div data-canvas-more-row hidden><p data-canvas-shown></p><button type="button" data-canvas-more></button></div>
  <p data-canvas-back hidden><a href="#find-title">Back to filters</a></p>`;

const PAGE = `
<div data-canvas-root>
  ${form()}
  <section id="idea" data-canvas-group><span data-group-count></span><ul>
    ${card("ignite", "idea", "event", "Boulder", "Ignite Boulder, open startup gathering")}
  </ul></section>
  <section id="launch" data-canvas-group><span data-group-count></span><ul>
    ${card("angels", "launch", "investor", "Denver", "Denver Angels, angel investor group")}
    ${card("seedco", "launch", "investor", "Boulder", "Seed Co, seed venture firm")}
  </ul></section>
  <section id="support" data-canvas-group><span data-group-count></span><ul>
    ${card("sbdc", "support", "government", "Denver", "Denver SBDC, free business advising")}
  </ul></section>
  ${tail}
</div>`;

// A page with more rows than one page holds: 30 Idea events in Denver, then
// 10 Launch investors in Boulder.
const LONG = `
<div data-canvas-root>
  ${form()}
  <section id="idea" data-canvas-group><ul>
    ${Array.from({ length: 30 }, (_, i) => card(`i${i + 1}`, "idea", "event", "Denver", `Idea ${i + 1}`)).join("")}
  </ul></section>
  <section id="launch" data-canvas-group><ul>
    ${Array.from({ length: 10 }, (_, i) => card(`l${i + 1}`, "launch", "investor", "Boulder", `Launch ${i + 1}`)).join("")}
  </ul></section>
  ${tail}
</div>`;

const shown = () => [...document.querySelectorAll<HTMLElement>("[data-resource]")].filter((e) => !e.hidden).map((e) => e.dataset.id);
const root = () => document.querySelector<HTMLElement>("[data-canvas-root]")!;
const status = () => document.querySelector("[data-canvas-count]")!.textContent;
const choose = (name: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!;
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("filter logic", () => {
  const allowed = { stage: new Set(["idea"]), type: new Set(["event"]), city: new Set(["Denver"]) };

  it("reads only allowed values from the URL and writes empty ones out", () => {
    expect(readState("?stage=idea&type=bogus&city=Denver&q=x", allowed)).toEqual({ stage: "idea", type: "", city: "Denver", q: "x" });
    expect(writeState({ stage: "idea", type: "", city: "", q: "law firm" })).toBe("?stage=idea&q=law+firm");
    expect(writeState({ stage: "", type: "", city: "", q: "" })).toBe("");
  });

  // PR #89 review: substage was not tested directly.
  it("reads a substage only when it is allowed, and writes it after the stage", () => {
    const withKinds = { ...allowed, substage: new Set(["investors"]) };
    expect(readState("?stage=idea&substage=investors", withKinds)).toEqual({ stage: "idea", substage: "investors", type: "", city: "", q: "" });
    expect(readState("?stage=idea&substage=bogus", withKinds)).toEqual({ stage: "idea", type: "", city: "", q: "" });
    // No allowed set means no substage is read.
    expect(readState("?substage=investors", allowed).substage).toBeUndefined();
    expect(writeState({ stage: "growth", substage: "investors", type: "", city: "", q: "" })).toBe("?stage=growth&substage=investors");
    expect(writeState({ stage: "growth", substage: undefined, type: "", city: "", q: "" })).toBe("?stage=growth");
  });

  it("matches only the chosen substage, so Support drops out under a kind", () => {
    const at = (stage: string, substage: string) => ({ id: substage, stage, substage, type: "investor", city: "Denver", text: "" });
    const state = { stage: "growth", substage: "investors", type: "", city: "", q: "" };
    expect(matches(at("growth", "investors"), state, null)).toBe(true);
    expect(matches(at("growth", "service-providers"), state, null)).toBe(false);
    expect(matches(at("support", "organizations"), state, null)).toBe(false);
    // Without a substage, Support still shows under the stage.
    expect(matches(at("support", "organizations"), { ...state, substage: undefined }, null)).toBe(true);
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

  it("counts each stage under the other filters, for the journey's chips", () => {
    const facts = [
      { id: "a", stage: "idea", type: "event", city: "Denver", text: "" },
      { id: "b", stage: "launch", type: "investor", city: "Denver", text: "" },
      { id: "c", stage: "launch", type: "investor", city: "Boulder", text: "" },
      { id: "d", stage: "support", type: "investor", city: "Denver", text: "" },
    ];
    // The chosen stage does not narrow the counts; the type does.
    expect(stageCounts(facts, { stage: "idea", type: "investor", city: "", q: "" }, null)).toEqual({ "": 3, launch: 2, support: 1 });
    expect(stageCounts(facts, { stage: "", type: "", city: "Denver", q: "" }, null)).toEqual({ "": 3, idea: 1, launch: 1, support: 1 });
  });

  it("shows the first matches up to the limit, in page order", () => {
    expect(pageOf([true, false, true, true, true], 2)).toEqual([true, false, true, false, false]);
    expect(pageOf([false, false], 24)).toEqual([false, false]);
  });

  it("raises the limit by whole pages to reach a linked row, and only for a match", () => {
    const matched = Array.from({ length: 60 }, (_, i) => i % 2 === 0);
    expect(PAGE_SIZE).toBe(24);
    // Index 50 is the 26th match: the second page holds it.
    expect(limitFor(matched, 50, PAGE_SIZE)).toBe(48);
    expect(limitFor(matched, 4, PAGE_SIZE)).toBe(PAGE_SIZE);
    expect(limitFor(matched, 51, PAGE_SIZE)).toBe(PAGE_SIZE);
    expect(limitFor(matched, 50, 72)).toBe(72);
  });

  it("keeps only sub-results on this page", () => {
    const ids = idsFromSubResults(["/ecosystem-canvas/#r-a", "/team/#r-b", "/ecosystem-canvas/", "https://x.example/ecosystem-canvas/#r-c"], "/ecosystem-canvas/");
    expect([...ids]).toEqual(["r-a", "r-c"]);
  });

  it("says how many match, how many show and how many more a click adds", () => {
    expect(countText(3, 3)).toBe("All 3 resources.");
    expect(countText(1, 3)).toBe("1 of 3 resources match.");
    expect(shownText(24, 245)).toBe("Showing 24 of 245.");
    expect(moreText(221)).toBe("Show 24 more");
    expect(moreText(7)).toBe("Show 7 more");
    expect(groupCountText(1)).toBe("1 resource");
    expect(groupCountText(12)).toBe("12 resources");
  });
});

describe("initCanvasFilters", () => {
  beforeEach(() => {
    document.body.innerHTML = PAGE;
    window.history.replaceState(null, "", "/ecosystem-canvas/");
  });

  it("shows everything at first, with the counts filled in", async () => {
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(document.querySelector<HTMLFormElement>("form")!.hidden).toBe(false);
    expect(shown()).toEqual(["ignite", "angels", "seedco", "sbdc"]);
    expect(status()).toBe("All 4 resources.");
    const count = (stage: string) => document.querySelector(`[data-stage-count="${stage}"]`)!.textContent;
    expect([count("idea"), count("launch"), count("support"), count("")]).toEqual(["1", "2", "1", "4"]);
    expect(document.querySelector<HTMLElement>("[data-canvas-more-row]")!.hidden).toBe(true);
  });

  it("reveals the Back to filters link with the form (#143)", async () => {
    const back = document.querySelector<HTMLElement>("[data-canvas-back]")!;
    expect(back.hidden).toBe(true);
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(back.hidden).toBe(false);
  });

  it("applies filters from the URL, checks their chips, hides empty stages and keeps the URL in step", async () => {
    window.history.replaceState(null, "", "/ecosystem-canvas/?type=investor&city=Boulder");
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(shown()).toEqual(["seedco"]);
    expect(document.querySelector<HTMLInputElement>('input[name="type"][value="investor"]')!.checked).toBe(true);
    expect(document.querySelector<HTMLElement>("#idea")!.hidden).toBe(true);
    expect(window.location.search).toBe("?type=investor&city=Boulder");
    expect(status()).toBe("1 of 4 resources match.");
  });

  it("filters when a chip is chosen, and counts each stage under the other filters", async () => {
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    choose("type", "investor");
    await settle();
    expect(shown()).toEqual(["angels", "seedco"]);
    expect(window.location.search).toBe("?type=investor");
    expect(document.querySelector('[data-stage-count="launch"]')!.textContent).toBe("2");
    expect(document.querySelector('[data-stage-count="idea"]')!.textContent).toBe("0");
    choose("stage", "support");
    await settle();
    expect(shown()).toEqual([]);
    expect(status()).toBe("0 of 4 resources match.");
  });

  it("keeps the stage anchor in the URL", async () => {
    window.history.replaceState(null, "", "/ecosystem-canvas/?stage=launch#launch");
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(window.location.hash).toBe("#launch");
    expect(window.location.search).toBe("?stage=launch");
  });

  it("chooses the stage a stage anchor names (decision 33), and drops the anchor once another stage is chosen", async () => {
    window.history.replaceState(null, "", "/ecosystem-canvas/#launch");
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(document.querySelector<HTMLInputElement>('input[name="stage"][value="launch"]')!.checked).toBe(true);
    expect(shown()).toEqual(["angels", "seedco", "sbdc"]);
    expect(window.location.search + window.location.hash).toBe("?stage=launch#launch");
    choose("stage", "idea");
    await settle();
    expect(window.location.search + window.location.hash).toBe("?stage=idea");
  });

  it("shows the Support group after the chosen stage (#134)", async () => {
    window.history.replaceState(null, "", "/ecosystem-canvas/?stage=launch");
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(shown()).toEqual(["angels", "seedco", "sbdc"]);
    expect(document.querySelector<HTMLElement>("#idea")!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("#support")!.hidden).toBe(false);
    expect(status()).toBe("3 of 4 resources match.");
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

  // M1c: each run hands the search_used reporter the query and the match
  // count (lib/search-used.ts sends only the count, once the query settles).
  it("reports each run's query and match count for search_used", async () => {
    window.history.replaceState(null, "", "/ecosystem-canvas/?q=seed%20venture");
    const report = vi.fn();
    const { apply } = initCanvasFilters(root(), async () => null, report);
    await apply();
    expect(report).toHaveBeenLastCalledWith("seed venture", 1);
    choose("type", "investor");
    await settle();
    expect(report).toHaveBeenLastCalledWith("seed venture", 1);
  });

  it("keeps each stage's count badge in step with the filters (#220)", async () => {
    window.history.replaceState(null, "", "/ecosystem-canvas/?city=Boulder");
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    const badge = () => document.querySelector("#launch [data-group-count]")!.textContent;
    expect(badge()).toBe("1 resource");
    const city = document.querySelector<HTMLSelectElement>("select[name=city]")!;
    city.value = "";
    city.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(badge()).toBe("2 resources");
  });
});

describe("initCanvasFilters, one page at a time", () => {
  beforeEach(() => {
    document.body.innerHTML = LONG;
    window.history.replaceState(null, "", "/ecosystem-canvas/");
  });
  const moreRow = () => document.querySelector<HTMLElement>("[data-canvas-more-row]")!;
  const more = () => document.querySelector<HTMLButtonElement>("[data-canvas-more]")!;

  it("shows the first 24 matches, hides a stage with none showing, and offers the rest", async () => {
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(shown()).toHaveLength(PAGE_SIZE);
    expect(document.querySelector<HTMLElement>("#launch")!.hidden).toBe(true);
    expect(moreRow().hidden).toBe(false);
    expect(more().textContent).toBe("Show 16 more");
    expect(document.querySelector("[data-canvas-shown]")!.textContent).toBe("Showing 24 of 40.");
    expect(status()).toBe("All 40 resources.");
  });

  it("adds a page on Show more, moves focus to the first new row, and starts again on a new filter", async () => {
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    more().click();
    await settle();
    expect(shown()).toHaveLength(40);
    expect(moreRow().hidden).toBe(true);
    expect((document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-resource]")?.dataset.id).toBe("i25");
    const city = document.querySelector<HTMLSelectElement>("select[name=city]")!;
    city.value = "Denver";
    city.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(shown()).toHaveLength(PAGE_SIZE);
  });

  it("shows a row a link points to, even past the first page", async () => {
    window.history.replaceState(null, "", "/ecosystem-canvas/#r-l3");
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(shown()).toContain("l3");
    // l3 is the 33rd match, so the second page shows, and 40 rows are all there are.
    expect(shown()).toHaveLength(40);
  });
});

// A browse row's link (?stage=growth&substage=investors) sets a kind with no
// control in the form; the chip beside the count line names and removes it.
const kindCard = (id: string, stage: string, substage: string, type: string, city: string) =>
  `<li data-resource data-id="${id}" data-stage="${stage}" data-substage="${substage}" data-type="${type}" data-city="${city}"><h3 id="r-${id}"><a href="https://x.example/${id}">${id}</a></h3></li>`;
const KINDS = `
<div data-canvas-root>
  ${form(["idea", "launch", "growth", "support"], ["investor", "service-provider", "government"])}
  <p data-canvas-kind hidden><span>Kind: <span data-canvas-kind-name></span></span><button type="button" aria-label="Remove the kind filter" data-canvas-kind-remove></button></p>
  <section id="growth" data-canvas-group><ul>
    ${kindCard("fund-a", "growth", "investors", "investor", "Denver")}
    ${kindCard("fund-b", "growth", "investors", "investor", "Boulder")}
    ${kindCard("law", "growth", "service-providers", "service-provider", "Denver")}
  </ul></section>
  <section id="support" data-canvas-group><ul>
    ${kindCard("sbdc", "support", "organizations", "government", "Denver")}
  </ul></section>
  ${tail}
</div>`;

describe("initCanvasFilters, the kind chip", () => {
  beforeEach(() => {
    document.body.innerHTML = KINDS;
    window.history.replaceState(null, "", "/ecosystem-canvas/?stage=growth&substage=investors");
  });
  const kind = () => document.querySelector<HTMLElement>("[data-canvas-kind]")!;
  const remove = () => document.querySelector<HTMLButtonElement>("[data-canvas-kind-remove]")!;

  it("names the kind from the URL with its display label", async () => {
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(kind().hidden).toBe(false);
    expect(document.querySelector("[data-canvas-kind-name]")!.textContent).toBe("Investors");
    expect(shown()).toEqual(["fund-a", "fund-b"]);
    expect(status()).toBe("2 of 4 resources match.");
  });

  it("stays hidden with no kind in the URL", async () => {
    window.history.replaceState(null, "", "/ecosystem-canvas/?stage=growth");
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    expect(kind().hidden).toBe(true);
  });

  it("removes only the kind, keeps the stage, updates the URL and moves focus to the count line", async () => {
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    remove().click();
    await settle();
    expect(kind().hidden).toBe(true);
    expect(window.location.search).toBe("?stage=growth");
    expect(shown()).toEqual(["fund-a", "fund-b", "law", "sbdc"]);
    expect(status()).toBe("All 4 resources.");
    expect(document.activeElement).toBe(document.querySelector("[data-canvas-count]"));
  });

  it("keeps the kind through a city change and drops it with a new stage", async () => {
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    const city = document.querySelector<HTMLSelectElement>("select[name=city]")!;
    city.value = "Denver";
    city.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(window.location.search).toBe("?stage=growth&substage=investors&city=Denver");
    expect(shown()).toEqual(["fund-a"]);
    expect(kind().hidden).toBe(false);
    choose("stage", "support");
    await settle();
    expect(window.location.search).toBe("?stage=support&city=Denver");
    expect(kind().hidden).toBe(true);
  });

  it("drops the kind on Clear", async () => {
    const { apply } = initCanvasFilters(root(), async () => null);
    await apply();
    document.querySelector<HTMLFormElement>("form")!.reset();
    await settle();
    await settle();
    expect(window.location.search).toBe("");
    expect(kind().hidden).toBe(true);
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
