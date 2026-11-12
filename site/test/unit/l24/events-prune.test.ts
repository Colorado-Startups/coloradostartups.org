// The /event-calendar/ list hides what has ended since the build (#225):
// each event, then each month left empty, then the introduction when none
// remain. An end that does not parse keeps its event shown.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { hideEnded } from "../../../src/components/events/prune";

const LIST = `<div data-upcoming>
  <p data-events-intro>Startup events coming up.</p>
  <section data-month id="oct"><ol>
    <li data-ends="2026-10-22T02:00:00.000Z" id="a"></li>
    <li data-ends="2026-10-30T02:00:00.000Z" id="b"></li>
  </ol></section>
  <section data-month id="nov"><ol>
    <li data-ends="2026-11-05T03:00:00.000Z" id="c"></li>
  </ol></section>
  <p data-events-empty hidden>No events are listed here right now.</p>
</div>`;

function list(html = LIST) {
  const doc = new JSDOM(html).window.document;
  const hidden = (id: string) => (doc.getElementById(id) as HTMLElement).hidden;
  const is = (selector: string) => (doc.querySelector(selector) as HTMLElement).hidden;
  return { root: doc.querySelector("[data-upcoming]")!, hidden, is };
}

describe("hideEnded", () => {
  it("shows everything before the first event ends", () => {
    const { root, hidden, is } = list();
    expect(hideEnded(root, Date.parse("2026-10-21T12:00:00Z"))).toBe(3);
    expect(["a", "b", "c", "oct", "nov"].map(hidden)).toEqual([false, false, false, false, false]);
    expect([is("[data-events-intro]"), is("[data-events-empty]")]).toEqual([false, true]);
  });

  it("hides an ended event, and its month once the month is empty", () => {
    const { root, hidden } = list();
    expect(hideEnded(root, Date.parse("2026-10-22T02:00:00Z"))).toBe(2);
    expect(["a", "b", "oct"].map(hidden)).toEqual([true, false, false]);
    expect(hideEnded(root, Date.parse("2026-11-01T00:00:00Z"))).toBe(1);
    expect(["b", "oct", "c", "nov"].map(hidden)).toEqual([true, true, false, false]);
  });

  it("swaps the introduction for the empty message when every event has ended", () => {
    const { root, is } = list();
    expect(hideEnded(root, Date.parse("2026-12-01T00:00:00Z"))).toBe(0);
    expect([is("[data-events-intro]"), is("[data-events-empty]")]).toEqual([true, false]);
  });

  it("keeps an event whose end does not parse", () => {
    const { root, hidden } = list(LIST.replace("2026-10-22T02:00:00.000Z", "soon"));
    hideEnded(root, Date.parse("2026-12-01T00:00:00Z"));
    expect([hidden("a"), hidden("oct")]).toEqual([false, false]);
  });
});
