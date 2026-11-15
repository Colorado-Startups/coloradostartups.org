// Keeps the next-events cards on /event-calendar/ current (#225). The page is
// static: the build renders every event that had not ended, the first
// NEXT_COUNT shown and the rest hidden. This runs the same check on the
// visitor's clock, so a page built days ago still leads with what is next.
// Without JavaScript the build-time cards stand. Owner: L24.

/**
 * Hides each card (li[data-ends]) that ended by `now`, then shows the first
 * `count` of the rest and hides the others. An end that does not parse keeps
 * its card in line. When none remain, shows the empty message
 * ([data-events-empty]). Returns how many cards show.
 */
export function showNext(root: Element, now: number, count: number): number {
  let shown = 0;
  for (const li of root.querySelectorAll<HTMLElement>("li[data-ends]")) {
    const ended = Date.parse(li.dataset.ends ?? "") <= now;
    li.hidden = ended || shown >= count;
    if (!li.hidden) shown++;
  }
  const empty = root.querySelector<HTMLElement>("[data-events-empty]");
  if (empty) empty.hidden = shown > 0;
  return shown;
}
