// The visitor's region (engagement plan step W8): one pick, kept on this
// device only. It lives in localStorage under one key. Nothing here sends it
// to the server, builds an id from it or hands it to analytics.
//
// Storage can be missing, blocked (a private window, site data off) or full.
// No function here throws then: a read gives null, so the site behaves as if
// nothing was picked, and a write or a clear reports false.
//
// Plain functions with no DOM and no zod, so the header's island stays small.
// The caller passes the real region ids: the page renders them from
// REGION_IDS (@cs/shared), whose index would pull zod into the browser.
// test/unit/your-region.test.ts covers each case.

/** The one localStorage key that holds the pick. */
export const YOUR_REGION_KEY = "cs-your-region";

/** The document event a change fires, so the header and This week stay in step. Its detail is the id, or null. */
export const YOUR_REGION_EVENT = "cs:your-region";

export type RegionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** `value` when it is one of the real region `ids`, else null. */
export function parseRegion<T extends string>(value: unknown, ids: readonly T[]): T | null {
  return typeof value === "string" && (ids as readonly string[]).includes(value) ? (value as T) : null;
}

/** The page's localStorage, or null where even reading the property throws. */
export function deviceStore(win: Pick<Window, "localStorage">): RegionStore | null {
  try {
    return win.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The saved pick, or null when nothing valid is saved or storage throws. */
export function readRegion<T extends string>(store: RegionStore | null | undefined, ids: readonly T[]): T | null {
  try {
    return parseRegion(store?.getItem(YOUR_REGION_KEY), ids);
  } catch {
    return null;
  }
}

/** Saves a real region id. False for any other value, or when storage is missing or refuses. */
export function saveRegion(store: RegionStore | null | undefined, id: string, ids: readonly string[]): boolean {
  if (!store || parseRegion(id, ids) === null) return false;
  try {
    store.setItem(YOUR_REGION_KEY, id);
    return true;
  } catch {
    return false;
  }
}

/** Forgets the pick. False when storage is missing or refuses. */
export function clearRegion(store: RegionStore | null | undefined): boolean {
  if (!store) return false;
  try {
    store.removeItem(YOUR_REGION_KEY);
    return true;
  } catch {
    return false;
  }
}
