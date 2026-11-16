// The directory's filter island. Owner: L3. Without JavaScript the page is a
// complete, browsable directory: every row shows, and a <noscript> style
// hides the filter form, which could do nothing. This script filters the rows
// in place, shows the first PAGE_SIZE matches with a "Show more" button, keeps
// the journey's stage counts in step, and reveals the "Back to filters" link.
// The form is in the page from the first paint, so revealing nothing here
// moves the first screen (CLS, l5a.spec.ts).
//
// Text search asks Pagefind first (its index is built from dist/ after every
// build) and falls back to matching each row's own text, so search still
// works in `astro dev` or if the index fails to load. The query and filters
// live in the URL, so a filtered view can be shared or linked to, for example
// /ecosystem-canvas/?stage=launch. A stage anchor (#launch, decision 33)
// chooses that stage, and a resource anchor (#r-<id>) shows its row even past
// the first page.
//
// A kind (?substage=, from a Start here browse row) has no control in the
// form. A chip beside the count line names it and removes it. It holds
// through type, city and search changes, and goes with a new stage or Clear:
// each stage has its own kinds.
//
// Each settled search sends search_used with its match count, never its words
// (lib/search-used.ts, step M1c).

import { loadPagefind, type Pagefind } from "../../lib/pagefind";
import { searchReporter } from "../../lib/search-used";
import {
  countText,
  groupCountText,
  idsFromSubResults,
  limitFor,
  matches,
  moreText,
  opensOnList,
  PAGE_SIZE,
  pageOf,
  readState,
  shownText,
  stageCounts,
  terms,
  writeState,
  type CardFacts,
  type FilterState,
} from "./filter-logic";
import { SUBSTAGE_LABELS } from "./labels";

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

// A select, a text box, or a group of radio chips: each reads and sets .value.
type Control = { value: string };

type Report = (query: string, results: number) => void;

export function initCanvasFilters(
  root: HTMLElement,
  search: Search = pagefindIds,
  report: Report = searchReporter("ecosystem-canvas"),
): { apply: () => Promise<void> } {
  const form = root.querySelector<HTMLFormElement>("form[data-canvas-filters]");
  const status = root.querySelector<HTMLElement>("[data-canvas-count]");
  if (!form || !status) return { apply: async () => {} };

  const cards = [...root.querySelectorAll<HTMLElement>("[data-resource]")].map((el) => ({
    el,
    facts: {
      id: el.dataset.id ?? "",
      stage: el.dataset.stage ?? "",
      substage: el.dataset.substage ?? "",
      type: el.dataset.type ?? "",
      city: el.dataset.city ?? "",
      text: el.textContent ?? "",
    } satisfies CardFacts,
  }));
  const indexOf = new Map(cards.map((c, i) => [c.el, i]));
  const groups = [...root.querySelectorAll<HTMLElement>("[data-canvas-group]")];
  // Each stage's count badge counts what the filters match, shown or not.
  const groupCounts = [...root.querySelectorAll<HTMLElement>("[data-group-count]")];
  // The journey's stage chips, each with its count under the other filters.
  const stageCountEls = [...root.querySelectorAll<HTMLElement>("[data-stage-count]")];
  const moreRow = root.querySelector<HTMLElement>("[data-canvas-more-row]");
  const moreButton = root.querySelector<HTMLButtonElement>("[data-canvas-more]");
  const shownLine = root.querySelector<HTMLElement>("[data-canvas-shown]");
  // Step L1b: the page opens on the picks, and the full list (with this
  // form) waits behind "Show all N resources". It ships hidden, and a
  // <noscript> style shows it when this script cannot run.
  const full = root.querySelector<HTMLElement>("[data-canvas-full]");
  const showAll = root.querySelector<HTMLButtonElement>("[data-canvas-show-all]");
  const picks = root.querySelector<HTMLElement>("[data-canvas-picks]");
  const kindRow = root.querySelector<HTMLElement>("[data-canvas-kind]");
  const kindName = root.querySelector<HTMLElement>("[data-canvas-kind-name]");
  const kindRemove = root.querySelector<HTMLButtonElement>("[data-canvas-kind-remove]");

  /** Shows the full list and retires its control. True when it was closed. */
  const openList = (): boolean => {
    if (!full || !full.hidden) return false;
    full.hidden = false;
    showAll?.setAttribute("aria-expanded", "true");
    const row = showAll?.closest<HTMLElement>("[data-canvas-show-row]");
    if (row) row.hidden = true;
    return true;
  };

  const control = (name: string) => form.elements.namedItem(name) as Control | null;
  // The values a control offers: a select's options, or each radio's value.
  const optionsOf = (name: string) =>
    new Set(
      [...form.querySelectorAll<HTMLElement>(`[name="${name}"]`)]
        .flatMap((el) =>
          el.tagName === "SELECT"
            ? [...el.querySelectorAll<HTMLOptionElement>("option")].map((o) => o.value)
            : [(el as HTMLInputElement).value],
        )
        .filter(Boolean),
    );
  const allowed = {
    stage: optionsOf("stage"),
    // No control offers substages; the rows' own values are the allowed ones.
    substage: new Set(cards.map((c) => c.facts.substage).filter(Boolean)),
    type: optionsOf("type"),
    city: optionsOf("city"),
  };
  const pagePath = window.location.pathname;

  let state: FilterState = readState(window.location.search, allowed);
  let limit = PAGE_SIZE;
  // A row a #r-<id> link points to, shown once the filters let it.
  let wanted: HTMLElement | null = null;

  const setControls = () => {
    for (const key of ["stage", "type", "city", "q"] as const) {
      const c = control(key);
      if (c) c.value = state[key];
    }
  };

  /** Reads the hash: a stage anchor chooses that stage; a resource anchor marks its row. */
  function readHash(): HTMLElement | null {
    const id = window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : "";
    const target = id ? document.getElementById(id) : null;
    if (!target) return null;
    // A link into the list (#launch, #r-<id>) opens it first.
    if (full?.contains(target)) openList();
    if (target.matches("section[data-canvas-group]") && allowed.stage.has(id) && id !== state.stage) {
      state = { ...state, stage: id, substage: undefined };
    }
    wanted = target.closest<HTMLElement>("[data-resource]");
    return target;
  }

  let run = 0;
  async function apply(): Promise<void> {
    const mine = ++run;
    const hits = state.q.trim() ? await search(state.q, pagePath) : null;
    if (mine !== run) return;
    // A query opens the list and sets the picks aside, so the results sit
    // right under the search box; an empty box brings the picks back.
    const searching = state.q.trim() !== "";
    if (searching) openList();
    if (picks) picks.hidden = searching;
    const matched = cards.map(({ facts }) => matches(facts, state, hits));
    if (wanted) {
      limit = limitFor(matched, indexOf.get(wanted) ?? -1, limit);
      wanted = null;
    }
    const show = pageOf(matched, limit);
    cards.forEach(({ el }, i) => (el.hidden = !show[i]));
    for (const g of groups) g.hidden = !g.querySelector("[data-resource]:not([hidden])");
    for (const c of groupCounts) {
      const group = c.closest("[data-canvas-group]");
      if (!group) continue;
      const n = [...group.querySelectorAll<HTMLElement>("[data-resource]")].filter((el) => matched[indexOf.get(el) ?? -1]).length;
      c.textContent = groupCountText(n);
    }
    const counts = stageCounts(
      cards.map((c) => c.facts),
      state,
      hits,
    );
    for (const el of stageCountEls) el.textContent = String(counts[el.dataset.stageCount ?? ""] ?? 0);

    const nMatched = matched.filter(Boolean).length;
    const nShown = show.filter(Boolean).length;
    status!.textContent = countText(nMatched, cards.length);
    report(state.q, nMatched);
    if (kindRow) kindRow.hidden = !state.substage;
    if (kindName) kindName.textContent = state.substage ? (SUBSTAGE_LABELS[state.substage] ?? state.substage) : "";
    if (moreRow) moreRow.hidden = nShown >= nMatched;
    if (shownLine) shownLine.textContent = shownText(nShown, nMatched);
    if (moreButton) moreButton.textContent = moreText(nMatched - nShown);

    // Keep the hash: Communitas links straight to #idea, #launch, #growth and
    // #support (decision 33), and the guides to #r-<id>. A stage anchor goes
    // once another stage is chosen, so a reload keeps the visitor's choice.
    const hashId = window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : "";
    const hash = allowed.stage.has(hashId) && hashId !== state.stage ? "" : window.location.hash;
    const next = `${pagePath}${writeState(state)}${hash}`;
    const now = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== now) window.history.replaceState(null, "", next);
  }

  const read = (): FilterState => ({
    stage: control("stage")?.value ?? "",
    type: control("type")?.value ?? "",
    city: control("city")?.value ?? "",
    q: control("q")?.value ?? "",
  });
  // A new filter starts the list again at its first page. The kind holds
  // unless the stage changed.
  const refilter = () => {
    const next = read();
    state = next.stage === state.stage && state.substage ? { ...next, substage: state.substage } : next;
    limit = PAGE_SIZE;
    return apply();
  };

  // On a phone the first result can sit at the fold after a menu change, so
  // the stage holding it scrolls into view (#724). Only for the city menu:
  // the chips sit just above the list and the status line under them counts
  // the result, so a visitor can tap one chip after another in place; the
  // search box fires change when it loses focus, and typing must keep its
  // place. Wide screens, and a result already in the upper part of the
  // screen, stay. The list ends with a "Back to filters" link to the form.
  function revealFirstResult(): void {
    if (!window.matchMedia?.("(max-width: 40rem)").matches) return;
    const stage = root.querySelector<HTMLElement>("[data-resource]:not([hidden])")?.closest("section");
    if (!stage || typeof stage.scrollIntoView !== "function") return;
    if (stage.getBoundingClientRect().top < window.innerHeight * 0.6) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stage.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
  }

  // Listened for on the root: the search box sits above the picks, outside
  // the form's markup, and joins it through form="canvas-filters" (step
  // L1b). Only this form's own controls count, not Resourcus's.
  const ours = (e: Event) => (e.target as HTMLInputElement | null)?.form === form;
  let timer: ReturnType<typeof setTimeout> | undefined;
  root.addEventListener("change", (e) => {
    if (!ours(e)) return;
    const menu = (e.target as HTMLElement).tagName === "SELECT";
    void refilter().then(() => {
      if (menu) revealFirstResult();
    });
  });
  root.addEventListener("input", (e) => {
    if (!ours(e) || (e.target as HTMLElement).getAttribute("name") !== "q") return;
    clearTimeout(timer);
    timer = setTimeout(() => void refilter(), 200);
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void refilter();
  });
  form.addEventListener("reset", () => {
    // The reset event fires before the controls clear. Clear drops the kind too.
    setTimeout(() => {
      state = { ...state, substage: undefined };
      void refilter();
    }, 0);
  });

  // Removing the kind keeps every other filter. Focus moves to the count
  // line, which also announces the new count, since the chip is gone.
  kindRemove?.addEventListener("click", () => {
    state = { ...state, substage: undefined };
    limit = PAGE_SIZE;
    void apply().then(() => status!.focus());
  });

  // "Show more" adds a page, then moves focus to the first new row's link, so
  // a keyboard or screen reader user carries on from where the list grew.
  moreButton?.addEventListener("click", () => {
    const before = cards.filter(({ el }) => !el.hidden).length;
    limit += PAGE_SIZE;
    void apply().then(() => {
      const next = cards.filter(({ el }) => !el.hidden)[before];
      next?.el.querySelector<HTMLElement>("a")?.focus();
    });
  });

  const scrollTo = (target: HTMLElement | null) => {
    // Feature-checked: an environment without scrollIntoView (jsdom, some
    // embedded browsers) just stays where it is.
    if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start" });
  };
  window.addEventListener("hashchange", () => {
    const target = readHash();
    if (!target) return;
    setControls();
    void apply().then(() => scrollTo(target));
  });

  // "Show all" opens the list and moves focus to its heading, so a keyboard
  // or screen reader user carries on at the list's filters.
  showAll?.addEventListener("click", () => {
    if (!openList()) return;
    const heading = root.querySelector<HTMLElement>("#find-title");
    (heading ?? form.querySelector<HTMLElement>("input, select"))?.focus();
  });

  form.hidden = false;
  for (const back of root.querySelectorAll<HTMLElement>("[data-canvas-back]")) back.hidden = false;
  // A filtered or searched URL opens on the list, as before step L1b, so a
  // shared link or a region page's "See all" lands on its results.
  const byUrl = opensOnList(window.location.search) && openList();
  const target = readHash() ?? (byUrl ? full : null);
  setControls();
  void apply().then(() => scrollTo(target));
  return { apply };
}
