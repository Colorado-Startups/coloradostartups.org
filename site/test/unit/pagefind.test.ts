// loadPagefind() imports Pagefind once per page but never keeps a failure, so
// one network blip cannot turn off the Canvas filters' search or the Resourcus
// panel's keyword search for the rest of the visit.
import { describe, expect, it, vi } from "vitest";

const good = { search: async () => ({ results: [] }) };

/** A fresh copy of the module, so each test starts with nothing cached. */
async function fresh() {
  vi.resetModules();
  return (await import("../../src/lib/pagefind")).loadPagefind;
}

describe("loadPagefind", () => {
  it("imports again after a failed import", async () => {
    const loadPagefind = await fresh();
    expect(await loadPagefind(() => Promise.reject(new Error("offline")))).toBeNull();
    expect(await loadPagefind(async () => good)).toBe(good);
  });

  it("imports again after a module with no search()", async () => {
    const loadPagefind = await fresh();
    expect(await loadPagefind(async () => ({}))).toBeNull();
    expect(await loadPagefind(async () => good)).toBe(good);
  });

  it("imports once after a success", async () => {
    const loadPagefind = await fresh();
    const load = vi.fn(async () => good);
    expect(await loadPagefind(load)).toBe(good);
    expect(await loadPagefind(load)).toBe(good);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
