// @vitest-environment jsdom
//
// M1c: search_used (src/lib/search-used.ts). Once a query's results settle,
// one event goes out with the count, never the words. track() is mocked, so
// this checks the name and props each search hands it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SEARCH_SETTLE_MS, searchReporter, watchPagefind } from "../../../src/lib/search-used";
import { track } from "../../../src/lib/track";

vi.mock("../../../src/lib/track", () => ({ track: vi.fn(() => true) }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.mocked(track).mockClear();
});

describe("searchReporter", () => {
  it("sends one search_used with the count once the query settles, and never the query", () => {
    const report = searchReporter("ecosystem-canvas");
    report("cow", 9);
    vi.advanceTimersByTime(SEARCH_SETTLE_MS / 2);
    report("cowork", 4);
    vi.advanceTimersByTime(SEARCH_SETTLE_MS);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("search_used", { where: "ecosystem-canvas", results: 4 });
    expect(JSON.stringify(vi.mocked(track).mock.calls)).not.toContain("cow");
  });

  it("sends nothing for an empty box, or for the same query run again", () => {
    const report = searchReporter("ask", 10);
    report("  ", 0);
    vi.advanceTimersByTime(20);
    expect(track).not.toHaveBeenCalled();
    report("hardware", 3);
    vi.advanceTimersByTime(20);
    report("hardware", 2);
    vi.advanceTimersByTime(20);
    expect(track).toHaveBeenCalledTimes(1);
    // Cleared and typed again, it counts again.
    report("", 0);
    report("hardware", 3);
    vi.advanceTimersByTime(20);
    expect(track).toHaveBeenCalledTimes(2);
  });

  it("drops a query cleared before it settles", () => {
    const report = searchReporter("ask", 10);
    report("hard", 5);
    report("", 0);
    vi.advanceTimersByTime(20);
    expect(track).not.toHaveBeenCalled();
  });
});

describe("watchPagefind", () => {
  type Handler = (arg: unknown) => void;
  function fakeUi() {
    const hooks: Record<string, Handler[]> = {};
    const instance = {
      on: (event: string, cb: Handler) => (hooks[event] ??= []).push(cb),
    };
    const fire = (event: string, arg: unknown) => hooks[event]?.forEach((cb) => cb(arg));
    const names: (string | undefined)[] = [];
    const ui = {
      getInstanceManager: () => ({
        getInstance: (name?: string) => {
          names.push(name);
          return instance;
        },
      }),
    };
    return { ui: ui as unknown as Parameters<typeof watchPagefind>[1], fire, names };
  }

  it("sends the result count of each settled search on /ask/'s default instance", () => {
    const { ui, fire, names } = fakeUi();
    expect(watchPagefind("ask", ui, 10)).toBe(true);
    expect(names).toEqual(["default"]);
    fire("search", "coworking");
    fire("results", { results: [{}, {}, {}] });
    vi.advanceTimersByTime(20);
    expect(track).toHaveBeenCalledWith("search_used", { where: "ask", results: 3 });
    // Pagefind clears with an empty results event when the box empties.
    fire("search", "");
    fire("results", { results: [] });
    vi.advanceTimersByTime(20);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the Component UI is not on the page", () => {
    expect(watchPagefind("ask", undefined)).toBe(false);
  });
});
