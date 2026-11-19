// search_used for a search box (step M1c): once a query's results settle, one
// event with the count. The query never leaves the page; it is kept only to
// tell a new query from the same one run again (a filter change, say).
// Startup Resources' search (canvas-filters.ts) and /ask/'s Pagefind box use it.

import { track } from "./track";

/** How long a query must stand before it counts, so typing a word sends one event, not one per pause. */
export const SEARCH_SETTLE_MS = 1000;

/** Where pagehide fires: the window, or a stand-in in tests. */
type LeavingPage = { addEventListener(type: "pagehide", listener: () => void): void };

/**
 * A reporter: call it after each run with the query and its result count.
 * A visitor who leaves before the query settles still counts: on pagehide a
 * waiting count goes out at once (sendBeacon survives the page), never twice.
 */
export function searchReporter(
  where: string,
  wait: number = SEARCH_SETTLE_MS,
  page: LeavingPage | null = typeof window === "undefined" ? null : window,
): (query: string, results: number) => void {
  let last = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting: (() => void) | null = null;
  const send = () => {
    clearTimeout(timer);
    const count = waiting;
    waiting = null;
    count?.();
  };
  page?.addEventListener("pagehide", send);
  return (query, results) => {
    clearTimeout(timer);
    waiting = null;
    const q = query.trim();
    if (!q) {
      last = "";
      return;
    }
    if (q === last) return;
    waiting = () => {
      last = q;
      track("search_used", { where, results });
    };
    timer = setTimeout(send, wait);
  };
}

/** The parts of Pagefind's Component UI instance this needs. */
interface PagefindInstance {
  on(event: "search", callback: (term: string) => void): void;
  on(event: "results", callback: (found: { results?: unknown[] } | null) => void): void;
}
type PagefindComponents = { getInstanceManager(): { getInstance(name?: string): PagefindInstance } };

/**
 * Reports each settled search in Pagefind's Component UI (/ask/). Its "search"
 * event names the query and its "results" event the hits; the default
 * instance is the one a bare <pagefind-config> sets up. False when the UI is
 * not on the page.
 */
export function watchPagefind(where: string, ui: PagefindComponents | undefined, wait?: number): boolean {
  const instance = ui?.getInstanceManager?.().getInstance("default");
  if (!instance) return false;
  const report = searchReporter(where, wait);
  let term = "";
  instance.on("search", (t) => (term = typeof t === "string" ? t : ""));
  instance.on("results", (found) => report(term, found?.results?.length ?? 0));
  return true;
}
