// The filters on /event-calendar/'s full events list (EventList.astro): region,
// "This week" and in person or online. They run on the visitor's clock with no
// page load, and the choice lives in the URL (?region=space-peak&when=week
// &type=online) so a filtered list can be shared. Past events drop out first
// through prune.ts's showNext, as the next-events cards do. Owner: L2a.
import { CALENDAR_TIMEZONE } from "../info/links";
import { showNext } from "./prune";

export interface ListFilter {
  /** A region id, "elsewhere", or "" for every place. */
  region: string;
  /** "week" for this week (today through Sunday, Mountain Time), or "". */
  when: string;
  /** "in-person", "online", or "". A row matches when its data-type lists it. */
  type: string;
}

export const NO_FILTER: ListFilter = { region: "", when: "", type: "" };
const KEYS = ["region", "when", "type"] as const;

/** The filter a query string asks for. Values the form does not offer are dropped later. */
export function readFilter(search: string): ListFilter {
  const params = new URLSearchParams(search);
  return { region: params.get("region") ?? "", when: params.get("when") ?? "", type: params.get("type") ?? "" };
}

/** The query string for a filter: "" when nothing is set, so the plain URL stays plain. */
export function filterQuery(filter: ListFilter): string {
  const params = new URLSearchParams();
  for (const key of KEYS) if (filter[key]) params.set(key, filter[key]);
  const text = params.toString();
  return text ? `?${text}` : "";
}

const dayParts = new Intl.DateTimeFormat("en-US", {
  timeZone: CALENDAR_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar day of an instant in Mountain Time, as YYYY-MM-DD. */
export function denverDay(ms: number): string {
  const parts = dayParts.formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The Sunday that ends the week holding `day` (weeks run Monday to Sunday). */
export function weekEnd(day: string): string {
  const noon = Date.parse(`${day}T12:00:00Z`);
  const weekday = new Date(noon).getUTCDay(); // 0 is Sunday
  return new Date(noon + ((7 - weekday) % 7) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Shows the events (li[data-ends]) that have not ended by `now` and match the
 * filter, hides the rest, hides each day ([data-day-group]) left empty, and
 * shows [data-list-none] when upcoming events exist but none match. Returns
 * how many show and how many have not ended.
 */
export function applyFilter(root: Element, filter: ListFilter, now: number): { shown: number; upcoming: number } {
  const upcoming = showNext(root, now, Number.POSITIVE_INFINITY);
  const lastDay = filter.when === "week" ? weekEnd(denverDay(now)) : "";
  let shown = 0;
  for (const li of root.querySelectorAll<HTMLElement>("li[data-ends]")) {
    if (li.hidden) continue;
    const match =
      (!filter.region || li.dataset.region === filter.region) &&
      // data-type lists every format a row has ("in-person online" for a hybrid event, L2b).
      (!filter.type || (li.dataset.type ?? "").split(" ").includes(filter.type)) &&
      (!lastDay || (li.dataset.day ?? "") <= lastDay);
    li.hidden = !match;
    if (match) shown++;
  }
  for (const group of root.querySelectorAll<HTMLElement>("[data-day-group]")) {
    group.hidden = !group.querySelector("li[data-ends]:not([hidden])");
  }
  const none = root.querySelector<HTMLElement>("[data-list-none]");
  if (none) none.hidden = shown > 0 || upcoming === 0;
  return { shown, upcoming };
}

/** The status line under the chips. */
export function countText(shown: number, upcoming: number): string {
  if (shown === upcoming) return `Showing all ${upcoming} upcoming ${upcoming === 1 ? "event" : "events"}.`;
  return `Showing ${shown} of ${upcoming} upcoming events.`;
}

/** The filter the form shows. A group with no checked radio counts as unset. */
function formFilter(form: HTMLFormElement): ListFilter {
  const data = new FormData(form);
  return { region: String(data.get("region") ?? ""), when: String(data.get("when") ?? ""), type: String(data.get("type") ?? "") };
}

/** Checks the radio for each value in `filter`, or the group's "All" when the form has no such choice. */
function setForm(form: HTMLFormElement, filter: ListFilter): void {
  for (const key of KEYS) {
    const radios = [...form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${key}"]`)];
    const pick = radios.find((r) => r.value === filter[key]) ?? radios.find((r) => r.value === "");
    if (pick) pick.checked = true;
  }
}

/**
 * Wires one list: reads the URL, filters, and filters again on every change,
 * writing the choice back to the URL with replaceState (the hash stays).
 */
export function initEventList(root: HTMLElement, now: () => number = Date.now): void {
  const form = root.querySelector<HTMLFormElement>("[data-list-filters]");
  const status = root.querySelector<HTMLElement>("[data-list-count]");
  const run = (writeUrl: boolean) => {
    const filter = form ? formFilter(form) : NO_FILTER;
    const { shown, upcoming } = applyFilter(root, filter, now());
    if (status) status.textContent = upcoming ? countText(shown, upcoming) : "";
    if (form) form.hidden = upcoming === 0;
    if (writeUrl) {
      const next = `${window.location.pathname}${filterQuery(filter)}${window.location.hash}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (next !== current) window.history.replaceState(window.history.state, "", next);
    }
  };
  if (form) {
    setForm(form, readFilter(window.location.search));
    form.addEventListener("change", () => run(true));
    form.addEventListener("submit", (event) => event.preventDefault());
    // The reset event fires before the radios change back; read them after.
    form.addEventListener("reset", () => setTimeout(() => run(true), 0));
  }
  root.querySelector("[data-list-clear]")?.addEventListener("click", () => {
    form?.reset();
  });
  run(false);
}
