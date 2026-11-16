// Step P2b: the This week strip on the visitor's clock (this-week.ts). Ended
// events hide, the next three show, each countdown counts from now, and on a
// region page the link on to the region's event list shows while fewer than
// three events do. Home's strip has no such link and refreshes as before.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { refreshBand } from "../../../src/components/events/this-week";

// Four events a week apart, ending an hour after they start (Denver, UTC-7).
const STARTS = ["2026-11-17T08:00:00-07:00", "2026-11-24T08:00:00-07:00", "2026-12-01T08:00:00-07:00", "2026-12-08T08:00:00-07:00"];
const item = (start: string, i: number) => {
  const s = Date.parse(start);
  const end = new Date(s + 3_600_000).toISOString();
  return `<li id="e${i}" data-starts="${new Date(s).toISOString()}" data-ends="${end}"${i >= 3 ? " hidden" : ""}>
    <time datetime="${start}" data-countdown>stale</time><a href="/event-calendar/">Event ${i}</a></li>`;
};

function strip(starts: readonly string[], { region }: { region: boolean }) {
  const html = `<div data-this-week data-count="3">
    <ol>${starts.map(item).join("")}</ol>
    <p data-events-empty${starts.length > 0 ? " hidden" : ""}>No events listed here yet.</p>
    ${region ? `<p data-events-more${starts.length >= 3 ? " hidden" : ""}><a href="/event-calendar/?region=space-peak#all-events">Events in Space Peak</a></p>` : ""}
  </div>`;
  const doc = new JSDOM(html).window.document;
  const root = doc.querySelector<HTMLElement>("[data-this-week]")!;
  const shown = () => [...root.querySelectorAll<HTMLElement>("li")].filter((li) => !li.hidden).map((li) => li.id);
  const visible = (sel: string) => root.querySelector<HTMLElement>(sel)?.hidden === false;
  return { root, shown, visible };
}

// 2026-11-16 at 10 AM in Denver.
const NOW = Date.parse("2026-11-16T10:00:00-07:00");

describe("refreshBand on a region page", () => {
  it("shows the next three, soonest first, and no link on while three show", () => {
    const { root, shown, visible } = strip(STARTS, { region: true });
    expect(refreshBand(root, NOW)).toBe(3);
    expect(shown()).toEqual(["e0", "e1", "e2"]);
    expect(visible("[data-events-more]")).toBe(false);
    expect(visible("[data-events-empty]")).toBe(false);
  });

  it("moves along as events end, without a rebuild", () => {
    const { root, shown, visible } = strip(STARTS, { region: true });
    // An hour after the first event started, it has ended.
    expect(refreshBand(root, Date.parse(STARTS[0]!) + 3_600_000)).toBe(3);
    expect(shown()).toEqual(["e1", "e2", "e3"]);
    expect(visible("[data-events-more]")).toBe(false);
  });

  it("shows the link on to the region's list once fewer than three remain", () => {
    const { root, shown, visible } = strip(STARTS, { region: true });
    expect(refreshBand(root, Date.parse(STARTS[2]!) + 3_600_000)).toBe(1);
    expect(shown()).toEqual(["e3"]);
    expect(visible("[data-events-more]")).toBe(true);
    expect(visible("[data-events-empty]")).toBe(false);
  });

  it("with fewer than three at build, shows what there is and the link", () => {
    const { root, shown, visible } = strip(STARTS.slice(0, 2), { region: true });
    expect(refreshBand(root, NOW)).toBe(2);
    expect(shown()).toEqual(["e0", "e1"]);
    expect(visible("[data-events-more]")).toBe(true);
  });

  it("says none in one line, with the link, once every event has ended", () => {
    const { root, shown, visible } = strip(STARTS, { region: true });
    expect(refreshBand(root, Number.MAX_SAFE_INTEGER)).toBe(0);
    expect(shown()).toEqual([]);
    expect(visible("[data-events-empty]")).toBe(true);
    expect(visible("[data-events-more]")).toBe(true);
  });

  it("rewrites each countdown from now", () => {
    const { root } = strip(STARTS, { region: true });
    refreshBand(root, NOW);
    const when = [...root.querySelectorAll("[data-countdown]")].map((t) => t.textContent);
    expect(when).toEqual(["tomorrow", "in 8 days", "in 15 days", "in 22 days"]);
  });
});

describe("refreshBand on home", () => {
  it("prunes and counts down as before, with no link on to add", () => {
    const { root, shown, visible } = strip(STARTS, { region: false });
    expect(refreshBand(root, Date.parse(STARTS[2]!) + 3_600_000)).toBe(1);
    expect(shown()).toEqual(["e3"]);
    expect(root.querySelector("[data-events-more]")).toBeNull();
    expect(visible("[data-events-empty]")).toBe(false);
    expect(root.querySelector("#e3 [data-countdown]")?.textContent).toBe("in 7 days");
  });
});
