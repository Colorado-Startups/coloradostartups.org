// The directory's filter island. Owner: L3. Without JavaScript the page is a
// complete, browsable directory and the filter form stays hidden; this script
// reveals the form and the "Back to filters" links, and filters the cards in
// place.
//
// Text search asks Pagefind first (its index is built from dist/ after every
// build) and falls back to matching each card's own text, so search still
// works in `astro dev` or if the index fails to load. The query and filters
// live in the URL, so a filtered view can be shared or linked to, for example
// /ecosystem-canvas/?stage=launch.

import { loadPagefind, type Pagefind } from "../../lib/pagefind";
import {
  countText,
  grounds,
  groupCountText,
  idsFromSubResults,
  matches,
  readState,
  terms,
  writeState,
  type CardFacts,
  type FilterState,
} from "./filter-logic";

const CARD_ID_PREFIX = "r-";

async function idsForTerm(pf: Pagefind, term: string, pagePath: string): Promise<Set<string> | null> {
  const res = await pf.search(term);
  if (!res) return null;
  const data = await Promise.all(res.results.slice(0, 40).map((r) => r.data()));
  const urls = data.flatMap((d) => [d.url, ...(d.sub_results ?? []).map((s) => s.url)]);
  const anchors = idsFromSubResults(urls, pagePath);
  return new Set([...anchors].filter((a) => a.startsWith(CARD_ID_PREFIX)).map((a) => a.slice(CARD_ID_PREFIX.length)));
}

/**
 * Card ids Pagefind finds on this page, or null when Pagefind is unavailable.
 * Pagefind returns every section that holds any one of the words, so each
 * word is searched on its own and the sets are intersected: "coworking
 * boulder" means coworking in Boulder, with Pagefind's stemming kept.
 */
async function pagefindIds(q: string, pagePath: string): Promise<Set<string> | null> {
  const pf = await loadPagefind();
  const words = terms(q);
  if (!pf || words.length === 0) return null;
  try {
    const sets: Set<string>[] = [];
    for (const word of words) {
      const ids = await idsForTerm(pf, word, pagePath);
      if (!ids) return null;
      sets.push(ids);
    }
    const [first, ...rest] = sets;
    return new Set([...first].filter((id) => rest.every((s) => s.has(id))));
  } catch {
    return null;
  }
}

type Search = (q: string, pagePath: string) => Promise<Set<string> | null>;

export function initCanvasFilters(root: HTMLElement, search: Search = pagefindIds): { apply: () => Promise<void> } {
  const form = root.querySelector<HTMLFormElement>("form[data-canvas-filters]");
  const status = root.querySelector<HTMLElement>("[data-canvas-count]");
  if (!form || !status) return { apply: async () => {} };

  const cards = [...root.querySelectorAll<HTMLElement>("[data-resource]")].map((el) => ({
    el,
    facts: {
      id: el.dataset.id ?? "",
      stage: el.dataset.stage ?? "",
      type: el.dataset.type ?? "",
      city: el.dataset.city ?? "",
      text: el.textContent ?? "",
    } satisfies CardFacts,
  }));
  const groups = [...root.querySelectorAll<HTMLElement>("[data-canvas-group]")];
  // Each substage's count badge counts what the filters leave showing.
  const groupCounts = [...root.querySelectorAll<HTMLElement>("[data-group-count]")];
  // The page's sections alternate band and lit grounds. Hiding a stage would
  // set two of one ground side by side, so the grounds are dealt again over
  // the sections still showing (#310).
  const sections = [...root.querySelectorAll<HTMLElement>(":scope > .section--band, :scope > .section--lit")];
  const firstGround = sections[0]?.classList.contains("section--band") ? "band" : "lit";
  const control = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
  const optionsOf = (name: string) =>
    new Set([...((control(name) as HTMLSelectElement | null)?.options ?? [])].map((o) => o.value).filter(Boolean));
  const allowed = { stage: optionsOf("stage"), type: optionsOf("type"), city: optionsOf("city") };
  const pagePath = window.location.pathname;

  let state: FilterState = readState(window.location.search, allowed);
  for (const key of ["stage", "type", "city", "q"] as const) {
    const c = control(key);
    if (c) c.value = state[key];
  }

  let run = 0;
  async function apply(): Promise<void> {
    const mine = ++run;
    const hits = state.q.trim() ? await search(state.q, pagePath) : null;
    if (mine !== run) return;
    let shown = 0;
    for (const { el, facts } of cards) {
      const ok = matches(facts, state, hits);
      el.hidden = !ok;
      if (ok) shown += 1;
    }
    for (const g of groups) g.hidden = !g.querySelector("[data-resource]:not([hidden])");
    for (const c of groupCounts) {
      const group = c.closest("[data-canvas-group]");
      if (group) c.textContent = groupCountText(group.querySelectorAll("[data-resource]:not([hidden])").length);
    }
    grounds(
      sections.map((s) => !s.hidden),
      firstGround,
    ).forEach((ground, i) => {
      if (!ground) return;
      sections[i].classList.toggle("section--band", ground === "band");
      sections[i].classList.toggle("section--lit", ground === "lit");
    });
    status!.textContent = countText(shown, cards.length);
    // Keep the hash: Communitas links straight to #idea, #launch, #growth and
    // #support (decision 33).
    const next = `${pagePath}${writeState(state)}${window.location.hash}`;
    const now = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== now) window.history.replaceState(null, "", next);
  }

  const read = (): FilterState => ({
    stage: control("stage")?.value ?? "",
    type: control("type")?.value ?? "",
    city: control("city")?.value ?? "",
    q: control("q")?.value ?? "",
  });

  // On a phone the first result can sit at the fold after a menu change, so
  // the stage holding it scrolls into view (#724). Only for a menu: the search
  // box also fires change when it loses focus, and typing must keep its place.
  // Wide screens, and a result already in the upper part of the screen, stay.
  // Each stage ends with a "Back to filters" link to the form.
  function revealFirstResult(): void {
    if (!window.matchMedia?.("(max-width: 40rem)").matches) return;
    const stage = root.querySelector<HTMLElement>("[data-resource]:not([hidden])")?.closest("section");
    if (!stage || typeof stage.scrollIntoView !== "function") return;
    if (stage.getBoundingClientRect().top < window.innerHeight * 0.6) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stage.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  form.addEventListener("change", (e) => {
    state = read();
    const menu = (e.target as HTMLElement).tagName === "SELECT";
    void apply().then(() => {
      if (menu) revealFirstResult();
    });
  });
  form.addEventListener("input", (e) => {
    if ((e.target as HTMLElement).getAttribute("name") !== "q") return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      state = read();
      void apply();
    }, 200);
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    state = read();
    void apply();
  });
  form.addEventListener("reset", () => {
    // The reset event fires before the controls clear.
    setTimeout(() => {
      state = read();
      void apply();
    }, 0);
  });

  // Revealing the form moves everything below it, so a visitor who arrived
  // at an anchor is brought back to it. The "Back to filters" link that ends
  // each stage leads to the form, so it shows only with the form (#143).
  form.hidden = false;
  for (const back of root.querySelectorAll<HTMLElement>("[data-canvas-back]")) back.hidden = false;
  const target = window.location.hash ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null;
  void apply().then(() => {
    // Feature-checked: an environment without scrollIntoView (jsdom, some
    // embedded browsers) just stays where it is.
    if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start" });
  });
  return { apply };
}
