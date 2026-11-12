import { describe, expect, it } from "vitest";

import { SOON_DAYS } from "../../../src/components/events/events";
import { readDist } from "../pages";

// /event-calendar/ as it ships (#228): the next SOON_DAYS days of events show
// open, and later events fold into one closed <details>. The build ran a
// moment before this test, so the cut is checked with an hour of slack.

const d = new DOMParser().parseFromString(readDist("event-calendar/index.html"), "text/html");
const upcoming = d.querySelector(".upcoming")!;
const later = upcoming.querySelector<HTMLDetailsElement>("details[data-events-later]");
const startOf = (li: Element) => {
  const at = li.querySelector("time")?.getAttribute("datetime") ?? "";
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T12:00:00Z` : at);
};
const all = [...upcoming.querySelectorAll("li.event")];
const folded = later ? [...later.querySelectorAll("li.event")] : [];
const open = all.filter((li) => !folded.includes(li));
const HOUR = 3_600_000;
const cutoff = Date.now() + SOON_DAYS * 86_400_000;

describe("/event-calendar/ later events", () => {
  it("shows the next two weeks open", () => {
    if (all.length === 0) return;
    expect(open.length).toBeGreaterThan(0);
    // When nothing starts that soon, everything shows open instead.
    if (folded.length > 0) for (const li of open) expect(startOf(li)).toBeLessThan(cutoff + HOUR);
  });

  it("folds every later event into one closed details, after the open ones", () => {
    expect(upcoming.querySelectorAll("details")).toHaveLength(later ? 1 : 0);
    if (!later) return;
    expect(later.hasAttribute("open")).toBe(false);
    for (const li of folded) expect(startOf(li)).toBeGreaterThanOrEqual(cutoff - HOUR);
    const lastOpen = Math.max(...open.map(startOf));
    expect(Math.min(...folded.map(startOf))).toBeGreaterThanOrEqual(lastOpen);
  });

  it("names the fold, counts it and says how far it runs", () => {
    if (!later) return;
    const summary = (later.querySelector("summary")?.textContent ?? "").replace(/\s+/g, " ").trim();
    const lastDay = folded.at(-1)!.querySelector("time")!.textContent!.trim();
    expect(summary).toBe(`Later events (${folded.length}) through ${lastDay}`);
  });

  it("keeps heading ids unique when a month spans the cut", () => {
    const ids = [...d.querySelectorAll("[id]")].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of upcoming.querySelectorAll("section[aria-labelledby]")) {
      expect(d.getElementById(section.getAttribute("aria-labelledby")!)?.tagName).toBe("H3");
    }
  });
});
