// The /event-calendar/ cards move along as events end (#225): ended cards
// hide, the next `count` show, the rest wait hidden, and the empty message
// shows once none remain. An end that does not parse keeps its card in line.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { showNext } from "../../../src/components/events/prune";

const CARDS = `<div data-next-events>
  <ol>
    <li data-ends="2026-10-22T02:00:00.000Z" id="a"></li>
    <li data-ends="2026-10-30T02:00:00.000Z" id="b"></li>
    <li data-ends="2026-11-05T03:00:00.000Z" id="c" hidden></li>
    <li data-ends="2026-11-09T03:00:00.000Z" id="d" hidden></li>
  </ol>
  <p data-events-empty hidden>No events are listed right now.</p>
</div>`;

function cards(html = CARDS) {
  const doc = new JSDOM(html).window.document;
  const shown = () => [...doc.querySelectorAll<HTMLElement>("li")].filter((li) => !li.hidden).map((li) => li.id);
  const empty = () => doc.querySelector<HTMLElement>("[data-events-empty]")!.hidden === false;
  return { root: doc.querySelector("[data-next-events]")!, shown, empty };
}

describe("showNext", () => {
  it("shows the first `count` cards before any event ends", () => {
    const { root, shown, empty } = cards();
    expect(showNext(root, Date.parse("2026-10-21T12:00:00Z"), 2)).toBe(2);
    expect(shown()).toEqual(["a", "b"]);
    expect(empty()).toBe(false);
  });

  it("hides an ended card and brings the next one in", () => {
    const { root, shown } = cards();
    expect(showNext(root, Date.parse("2026-10-22T02:00:00Z"), 2)).toBe(2);
    expect(shown()).toEqual(["b", "c"]);
    expect(showNext(root, Date.parse("2026-11-01T00:00:00Z"), 2)).toBe(2);
    expect(shown()).toEqual(["c", "d"]);
  });

  it("shows fewer when fewer remain, and the empty message when none do", () => {
    const { root, shown, empty } = cards();
    expect(showNext(root, Date.parse("2026-11-06T00:00:00Z"), 2)).toBe(1);
    expect(shown()).toEqual(["d"]);
    expect(showNext(root, Date.parse("2026-12-01T00:00:00Z"), 2)).toBe(0);
    expect(empty()).toBe(true);
  });

  it("keeps a card whose end does not parse", () => {
    const { root, shown } = cards(CARDS.replace("2026-10-22T02:00:00.000Z", "soon"));
    showNext(root, Date.parse("2026-12-01T00:00:00Z"), 2);
    expect(shown()).toEqual(["a"]);
  });
});
