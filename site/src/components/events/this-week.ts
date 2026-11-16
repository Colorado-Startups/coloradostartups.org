// The This week strip on the visitor's clock (ThisWeek.astro, steps P2a and
// P2b). The build writes the strip once; this runs again in the browser, so a
// page built days ago still leads with what is next. Plain DOM, no Astro, so
// the browser and the tests share it (test/unit/l8/this-week-band.test.ts).
import {
  deviceStore,
  parseRegion,
  readRegion,
  type RegionStore,
  YOUR_REGION_EVENT,
} from "../../lib/your-region";
import { countdown } from "./countdown";
import { showNext } from "./prune";

/**
 * Refreshes one strip ([data-this-week]) at `now`: hides the events that
 * ended and shows the next data-count of the rest (prune.ts), shows the link
 * on to more ([data-events-more], a region page's) while fewer than that
 * show, and rewrites each countdown. Returns how many events show.
 */
export function refreshBand(root: HTMLElement, now: number): number {
  const count = Number(root.dataset.count);
  const shown = showNext(root, now, count);
  const more = root.querySelector<HTMLElement>("[data-events-more]");
  if (more) more.hidden = shown >= count;
  for (const li of root.querySelectorAll<HTMLElement>("li[data-starts]")) {
    const start = Date.parse(li.dataset.starts ?? "");
    const when = li.querySelector("[data-countdown]");
    if (when && !Number.isNaN(start)) when.textContent = countdown(start, now);
  }
  return shown;
}

/** Each list's events in the order the build wrote them, soonest first. */
const buildOrder = new WeakMap<Element, HTMLElement[]>();

function eventsOf(root: HTMLElement): HTMLElement[] {
  const list = root.querySelector("ol");
  if (!list) return [];
  let built = buildOrder.get(list);
  if (!built) {
    built = [...list.children].filter((el): el is HTMLElement => el.matches("li[data-starts]"));
    buildOrder.set(list, built);
  }
  return built;
}

/** How many of the strip's events are placed in `region` and have not ended by `now`. */
export function eventsIn(root: HTMLElement, region: string, now: number): number {
  return eventsOf(root).filter((li) => li.dataset.eventRegion === region && Date.parse(li.dataset.ends ?? "") > now).length;
}

/**
 * Orders the strip's events and refreshes it at `now`. With `region`, the
 * events placed there come first, then the rest, each part soonest first.
 * With null, the build's order comes back.
 */
export function orderRegionFirst(root: HTMLElement, region: string | null, now: number): void {
  const built = eventsOf(root);
  const list = root.querySelector("ol");
  const first = (li: HTMLElement) => region !== null && li.dataset.eventRegion === region;
  // appendChild, not append: the Workers types give append another shape.
  for (const li of [...built.filter(first), ...built.filter((li) => !first(li))]) list?.appendChild(li);
  refreshBand(root, now);
}

/**
 * Home's strip (step W8). With a region picked on this device and one of its
 * events still ahead, its events come first and a line says so, with a button
 * to show every region in date order and back again. With no pick the strip
 * keeps the build's order and the line stays hidden. A pick made in the
 * header applies at once. A region page's strip has no line and is left alone.
 */
export function initRegionFirst(root: HTMLElement, store: RegionStore | null = deviceStore(window)): void {
  const line = root.querySelector<HTMLElement>("[data-region-first]");
  const text = line?.querySelector<HTMLElement>("[data-region-first-text]");
  const toggle = line?.querySelector<HTMLButtonElement>("button[data-region-first-toggle]");
  if (!line || !text || !toggle) return;
  let names: Record<string, string> = {};
  try {
    names = JSON.parse(line.dataset.regionNames ?? "{}") as Record<string, string>;
  } catch {
    // No names: the line stays hidden.
  }
  const ids = Object.keys(names);
  let region = readRegion(store, ids);
  let all = false;

  const render = () => {
    const now = Date.now();
    const name = region ? names[region] : undefined;
    const shown = region !== null && name !== undefined && eventsIn(root, region, now) > 0;
    orderRegionFirst(root, shown && !all ? region : null, now);
    line.hidden = !shown;
    if (!shown) return;
    text.textContent = all ? "Showing every region." : `Showing ${name} first.`;
    toggle.textContent = all ? `Show ${name} first` : "Show all";
  };

  toggle.addEventListener("click", () => {
    all = !all;
    render();
  });
  root.ownerDocument.addEventListener(YOUR_REGION_EVENT, (event) => {
    region = parseRegion((event as CustomEvent<unknown>).detail, ids);
    all = false;
    render();
  });
  // With no pick the build's order stands untouched.
  if (region !== null) render();
}
