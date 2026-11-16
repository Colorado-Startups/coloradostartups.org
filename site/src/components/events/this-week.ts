// The This week strip on the visitor's clock (ThisWeek.astro, steps P2a and
// P2b). The build writes the strip once; this runs again in the browser, so a
// page built days ago still leads with what is next. Plain DOM, no Astro, so
// the browser and the tests share it (test/unit/l8/this-week-band.test.ts).
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
