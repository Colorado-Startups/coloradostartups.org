// Pagefind's browser API, for the Canvas filters and the Resourcus panel.
// Pagefind indexes dist/ after `astro build`, so the import fails in
// `astro dev` and loadPagefind() resolves to null there. A failed or unusable
// import is never kept, so one network blip does not turn search off for the
// rest of the visit: the next search imports again.

const PAGEFIND_URL = "/pagefind/pagefind.js";

interface PagefindResult {
  data(): Promise<{ url: string; meta?: { title?: string }; sub_results?: { url: string }[] }>;
}

export interface Pagefind {
  search(q: string): Promise<{ results: PagefindResult[] } | null>;
}

const importPagefind = (): Promise<unknown> => import(/* @vite-ignore */ PAGEFIND_URL);
const isPagefind = (m: unknown): m is Pagefind => typeof (m as { search?: unknown } | null)?.search === "function";

let pagefind: Promise<Pagefind | null> | null = null;

function forget(): null {
  pagefind = null;
  return null;
}

/** The Pagefind module, imported once per page, or null when it cannot load. Tests pass `load`. */
export function loadPagefind(load: () => Promise<unknown> = importPagefind): Promise<Pagefind | null> {
  pagefind ??= load().then((m) => (isPagefind(m) ? m : forget()), forget);
  return pagefind;
}
