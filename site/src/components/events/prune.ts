// Hides the events on /event-calendar/ that have ended since the build
// (#225). The page is static, so upcomingEvents() keeps what had not ended
// when it was built; this runs the same check on the visitor's clock. Without
// JavaScript the build-time list stands. Owner: L24.

/**
 * Hides each event (li[data-ends]) that ended by `now`, then each month
 * ([data-month]) left with none. When none remain, swaps the introduction
 * ([data-events-intro]) for the empty message ([data-events-empty]). An end
 * that does not parse keeps its event shown. The later-events <details>
 * ([data-events-later]) hides when it has none left and opens when only its
 * events remain. Returns how many still show.
 */
export function hideEnded(root: Element, now: number): number {
  for (const li of root.querySelectorAll<HTMLElement>("li[data-ends]")) {
    if (Date.parse(li.dataset.ends ?? "") <= now) li.hidden = true;
  }
  let left = 0;
  for (const month of root.querySelectorAll<HTMLElement>("[data-month]")) {
    const shown = month.querySelectorAll("li[data-ends]:not([hidden])").length;
    month.hidden = shown === 0;
    left += shown;
  }
  // Later events (#228) fold into a <details>. Once every open event has
  // ended, open it, so a page built weeks ago still leads with what is next.
  const later = root.querySelector<HTMLDetailsElement>("details[data-events-later]");
  if (later) {
    const laterLeft = later.querySelectorAll("li[data-ends]:not([hidden])").length;
    later.hidden = laterLeft === 0;
    if (laterLeft > 0 && laterLeft === left) later.open = true;
  }
  const intro = root.querySelector<HTMLElement>("[data-events-intro]");
  const empty = root.querySelector<HTMLElement>("[data-events-empty]");
  if (intro) intro.hidden = left === 0;
  if (empty) empty.hidden = left > 0;
  return left;
}
