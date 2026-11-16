// Step P2a: the This week strip on home. The countdown checks are plain
// functions; the strip checks read the built site (run `npm run build` first;
// test:content does). Its band word count is in home-budget.test.ts too.
import { readFileSync } from "node:fs";
import path from "node:path";

import { REGION_IDS, WAYS_IN } from "@cs/shared";
import axe from "axe-core";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { countdown, daysUntil } from "../../../src/components/events/countdown";
import { showNext } from "../../../src/components/events/prune";
import { SLACK_JOIN } from "../../../src/lib/communitas/join";
import { readDist, SITE_DIR } from "../pages";

const threads = parse(
  readFileSync(path.join(SITE_DIR, "../data/communitas/threads.yaml"), "utf8"),
) as { day: string; title: string }[];

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();

// Words as home-budget.test.ts counts them: text nodes joined with a space.
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.,:/-]*/gu;
function words(root: Element): string[] {
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === child.TEXT_NODE)
        parts.push(child.textContent ?? "");
      else if (
        child.nodeType === child.ELEMENT_NODE &&
        !(child as Element).matches(
          "script, style, svg, [hidden], .visually-hidden",
        )
      )
        walk(child);
    }
  };
  walk(root);
  return parts.join(" ").match(WORD) ?? [];
}

describe("the countdown", () => {
  // 2026-11-16 at 10 AM in Denver (UTC-7).
  const now = Date.parse("2026-11-16T10:00:00-07:00");

  it("says today, tomorrow or in N days, by calendar day in Mountain Time", () => {
    expect(countdown(Date.parse("2026-11-16T18:00:00-07:00"), now)).toBe(
      "today",
    );
    expect(countdown(Date.parse("2026-11-17T08:00:00-07:00"), now)).toBe(
      "tomorrow",
    );
    expect(countdown(Date.parse("2026-11-18T08:00:00-07:00"), now)).toBe(
      "in 2 days",
    );
  });

  it("counts a late-evening Denver start as that day, not the next UTC day", () => {
    // 11 PM in Denver is 6 AM the next day in UTC.
    expect(daysUntil(Date.parse("2026-11-16T23:00:00-07:00"), now)).toBe(0);
  });

  it("says on now once the event has started", () => {
    expect(countdown(Date.parse("2026-11-16T09:00:00-07:00"), now)).toBe(
      "on now",
    );
  });
});

let home: Document;
let band: HTMLElement;
const events = () => band.querySelector<HTMLElement>("[data-this-week]")!;

describe("This week on home", () => {
  beforeAll(() => {
    home = new DOMParser().parseFromString(readDist("index.html"), "text/html");
    band = home.querySelector<HTMLElement>(
      'section[aria-labelledby="this-week"]',
    )!;
  });

  it("is a band headed This week, above Where", () => {
    expect(band).not.toBeNull();
    expect(text(band.querySelector("h2#this-week"))).toBe("This week");
    const where = home.querySelector('section[aria-labelledby="where"]')!;
    expect(
      band.compareDocumentPosition(where) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows at most the next 3 events, each with a countdown and a link to the event calendar", () => {
    const shown = [
      ...events().querySelectorAll<HTMLElement>("li[data-ends]:not([hidden])"),
    ];
    const empty = events().querySelector("[data-events-empty]")!;
    expect(shown.length).toBeLessThanOrEqual(3);
    expect(empty.hasAttribute("hidden")).toBe(shown.length > 0);
    if (shown.length === 0)
      expect(empty.querySelector("a")?.getAttribute("href")).toBe(
        WAYS_IN.events,
      );
    for (const li of shown) {
      const when = li.querySelector("time[data-countdown]")!;
      expect(when.getAttribute("datetime")).toBeTruthy();
      expect(text(when)).toMatch(/^(on now|today|tomorrow|in \d+ days)$/);
      const link = li.querySelector("a")!;
      expect(link.getAttribute("href")).toBe(WAYS_IN.events);
      // A cut title keeps its full text for assistive tech, with the date.
      expect(
        (link.getAttribute("aria-label") ?? "").startsWith(
          text(link).replace(/…$/, ""),
        ),
      ).toBe(true);
    }
  });

  it("lists the events soonest first", () => {
    const starts = [
      ...events().querySelectorAll<HTMLElement>("li[data-starts]"),
    ].map((li) => Date.parse(li.dataset.starts!));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("drops past events on the visitor's clock, without a rebuild", () => {
    const root = events().cloneNode(true) as HTMLElement;
    const items = [...root.querySelectorAll<HTMLElement>("li[data-ends]")];
    if (items.length === 0) return;
    const firstEnd = Date.parse(items[0]!.dataset.ends!);
    showNext(root, firstEnd, Number(root.dataset.count));
    expect(items[0]!.hidden).toBe(true);
    expect(showNext(root, Number.MAX_SAFE_INTEGER, 3)).toBe(0);
    expect(root.querySelector<HTMLElement>("[data-events-empty]")!.hidden).toBe(
      false,
    );
  });

  it("tags an event with its region only by a real region id", () => {
    for (const li of events().querySelectorAll<HTMLElement>(
      "li[data-event-region]",
    )) {
      expect(REGION_IDS as readonly string[]).toContain(li.dataset.eventRegion);
    }
  });

  it("shows the weekly thread rhythm from threads.yaml: Monday, Wednesday, Friday", () => {
    const rows = [
      ...band.querySelectorAll<HTMLElement>("[data-threads] li[data-day]"),
    ];
    expect(rows.map((r) => r.dataset.day)).toEqual(["mon", "wed", "fri"]);
    for (const r of rows) {
      const title = threads.find((t) => t.day === r.dataset.day)!.title;
      expect(text(r)).toContain(title);
    }
  });

  it("links the Slack and the LinkedIn Group through WAYS_IN", () => {
    const slack = band.querySelector('a[data-link="slack"]')!;
    const group = band.querySelector('a[data-link="linkedin-group"]')!;
    expect(slack.getAttribute("href")).toBe(SLACK_JOIN.href);
    expect(group.getAttribute("href")).toBe(WAYS_IN["linkedin-group"]);
    // The Slack link opens a Google Form; the hero's note says so.
    expect(
      text(home.getElementById(slack.getAttribute("aria-describedby") ?? "")),
    ).toBe("Join the Slack opens a Google Form.");
  });

  it("links only to WAYS_IN and the Slack join link, so no vendor sits on the strip", () => {
    const ways = new Set([...Object.values(WAYS_IN), SLACK_JOIN.href]);
    for (const a of band.querySelectorAll("a"))
      expect(ways.has(a.getAttribute("href")!), a.getAttribute("href")!).toBe(
        true,
      );
  });

  it("adds at most 50 visible words to home", () => {
    const n = words(band).length;
    console.info(`index.html: ${n} visible words in the This week band`);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(50);
  });

  it("keeps to the site's words: no member count, em dash, spaced en dash, Outpost, HQ or Hall", () => {
    expect(text(band)).not.toMatch(
      /\b\d[\d,.]*\s*\+?\s*(members|startupers|founders|people)\b/i,
    );
    expect(text(band)).not.toMatch(/—| – |\bOutpost\b|\bHQ\b|\bHall\b/);
  });

  it("passes axe (structure and ARIA; color contrast runs in the browser e2e)", async () => {
    const results = await axe.run(band, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
