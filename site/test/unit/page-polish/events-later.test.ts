// /event-calendar/ shows the next two weeks open and folds later events into
// a <details> (#228). splitSoon() makes the cut at build time; hideEnded()
// keeps it sensible on the visitor's clock as events end.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { type CalendarEvent, SOON_DAYS, splitSoon } from "../../../src/components/events/events";
import { hideEnded } from "../../../src/components/events/prune";

const event = (start: string, title = start): CalendarEvent =>
  ({ title, start, end: start, allDay: false, inPerson: true }) as CalendarEvent;

describe("splitSoon", () => {
  const now = Date.parse("2026-11-02T18:00:00Z");
  const events = [
    event("2026-11-03T15:00:00Z"),
    event("2026-11-16T17:59:00Z"),
    event("2026-11-16T18:00:00Z"),
    event("2026-12-17T01:00:00Z"),
  ];

  it("keeps events that start within SOON_DAYS open and folds the rest", () => {
    expect(SOON_DAYS).toBe(14);
    const { soon, later } = splitSoon(events, now);
    expect(soon.map((e) => e.start)).toEqual(["2026-11-03T15:00:00Z", "2026-11-16T17:59:00Z"]);
    expect(later.map((e) => e.start)).toEqual(["2026-11-16T18:00:00Z", "2026-12-17T01:00:00Z"]);
  });

  it("opens everything when nothing starts that soon", () => {
    const { soon, later } = splitSoon(events.slice(2), now);
    expect(soon).toHaveLength(2);
    expect(later).toEqual([]);
  });

  it("returns two empty parts for no events", () => {
    expect(splitSoon([], now)).toEqual({ soon: [], later: [] });
  });
});

const LIST = `<div data-upcoming>
  <p data-events-intro>Startup events coming up.</p>
  <div><section data-month><ol>
    <li data-ends="2026-11-03T16:00:00.000Z" id="a"></li>
    <li data-ends="2026-11-10T02:00:00.000Z" id="b"></li>
  </ol></section></div>
  <details data-events-later><summary>Later events</summary><section data-month><ol>
    <li data-ends="2026-11-20T02:00:00.000Z" id="c"></li>
  </ol></section></details>
  <p data-events-empty hidden>No events are listed here right now.</p>
</div>`;

function list() {
  const doc = new JSDOM(LIST).window.document;
  const later = doc.querySelector("details")!;
  return { root: doc.querySelector("[data-upcoming]")!, later };
}

describe("hideEnded with folded later events", () => {
  it("leaves the later events folded while open events remain", () => {
    const { root, later } = list();
    expect(hideEnded(root, Date.parse("2026-11-03T17:00:00Z"))).toBe(2);
    expect([later.open, later.hidden]).toEqual([false, false]);
  });

  it("opens them once every open event has ended", () => {
    const { root, later } = list();
    expect(hideEnded(root, Date.parse("2026-11-12T00:00:00Z"))).toBe(1);
    expect([later.open, later.hidden]).toEqual([true, false]);
  });

  it("hides the folded section once its events have ended too", () => {
    const { root, later } = list();
    expect(hideEnded(root, Date.parse("2026-11-21T00:00:00Z"))).toBe(0);
    expect(later.hidden).toBe(true);
  });
});
