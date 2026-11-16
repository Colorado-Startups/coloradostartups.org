// Step L2b, over the built site (run `npm run build` first; test:content does):
// each row of /event-calendar/'s list links its own built .ics file, the files
// stay out of the sitemap, every link has its own name, the subscribe link is
// the feed the build reads, and a hybrid event shows under both formats.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { feedUrl } from "../../../scripts/events/fetch-ics.mjs";
import { SNAPSHOT } from "../../src/components/events/events";
import { applyFilter, NO_FILTER } from "../../src/components/events/list-filter";
import { CALENDAR_ID, calendarFeedSubscribeUrl } from "../../src/components/info/links";
import { DIST_DIR, readDist, sitemapPaths } from "./pages";

const html = readDist("event-calendar/index.html");
const fresh = () => new DOMParser().parseFromString(html, "text/html");
const page = fresh();
const list = page.querySelector<HTMLElement>("[data-event-list]")!;
const rows = [...list.querySelectorAll<HTMLElement>("li[data-ends]")];
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

const unfold = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n").filter(Boolean);
const unescape = (value: string) => value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

describe("the Add to calendar links", () => {
  it("sit on every row, as real download links to a built .ics file", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const li of rows) {
      const a = li.querySelector<HTMLAnchorElement>("a[data-add-ics]")!;
      expect(a, text(li.querySelector(".ev__title"))).not.toBeNull();
      expect(a.hasAttribute("download")).toBe(true);
      const href = a.getAttribute("href")!;
      expect(href).toMatch(/^\/events\/\d{4}-\d{2}-\d{2}-[0-9a-f]{12}\.ics$/);
      expect(existsSync(path.join(DIST_DIR, href)), href).toBe(true);
    }
  });

  it("each open a file whose SUMMARY is the row's title", () => {
    for (const li of rows) {
      const href = li.querySelector("a[data-add-ics]")!.getAttribute("href")!;
      const ics = readFileSync(path.join(DIST_DIR, href), "utf8");
      const lines = unfold(ics);
      expect(lines[0]).toBe("BEGIN:VCALENDAR");
      const summary = lines.find((l) => l.startsWith("SUMMARY:"))!;
      expect(unescape(summary.slice("SUMMARY:".length))).toBe(text(li.querySelector(".ev__title")));
      expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    }
  });

  it("each have a distinct accessible name that starts with what they do", () => {
    const names = rows.map((li) => text(li.querySelector("a[data-add-ics]")));
    for (const [i, name] of names.entries()) {
      expect(name.startsWith("Add to calendar: ")).toBe(true);
      expect(name).toContain(text(rows[i]!.querySelector(".ev__title")));
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it("are files the sitemap leaves out", () => {
    const paths = sitemapPaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((p) => p.startsWith("/events/") || p.endsWith(".ics"))).toBe(false);
  });
});

describe("the Subscribe to all events link", () => {
  const link = list.querySelector<HTMLAnchorElement>("a[data-subscribe-feed]")!;

  it("comes before the first event and says what it does", () => {
    expect(text(link)).toBe("Subscribe to all events");
    expect(link.compareDocumentPosition(rows[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(text(link.parentElement)).toMatch(/calendar app/);
    expect(text(link.parentElement)).toMatch(/Google Calendar/);
  });

  it("is the public feed the build reads, as webcal so a calendar app subscribes", () => {
    const href = link.getAttribute("href")!;
    expect(href).toBe(calendarFeedSubscribeUrl());
    expect(href.replace(/^webcal:/, "https:")).toBe(feedUrl(CALENDAR_ID));
    expect(href.replace(/^webcal:/, "https:")).toBe(SNAPSHOT?.source);
  });
});

describe("format tags", () => {
  const byTitle = (re: RegExp) => rows.filter((li) => re.test(text(li.querySelector(".ev__title"))));

  it("tag a hybrid event in person and online, and list it under both filters", () => {
    const hybrid = byTitle(/Boulder Open Coffee Club/);
    if (hybrid.length === 0) return;
    for (const li of hybrid) {
      expect(li.dataset.type).toBe("in-person online");
      expect(text(li.querySelector("[data-format-tag]"))).toBe("In person and online");
    }
    for (const type of ["in-person", "online"]) {
      const root = fresh().querySelector("[data-event-list]")!;
      const firstEnd = Date.parse(rows[0]!.dataset.ends!);
      applyFilter(root, { ...NO_FILTER, type }, firstEnd - 60_000);
      const shown = [...root.querySelectorAll<HTMLElement>("li[data-ends]:not([hidden])")].map((li) => text(li.querySelector(".ev__title")));
      expect(shown.some((t) => /Boulder Open Coffee Club/.test(t)), type).toBe(true);
    }
  });

  it("say Place to be announced, not Online, for an event with no location", () => {
    for (const li of rows.filter((r) => !r.querySelector(".ev__place") && r.dataset.type === "")) {
      expect(text(li.querySelector("[data-format-tag]"))).toBe("Place to be announced");
    }
    for (const li of rows.filter((r) => text(r.querySelector("[data-format-tag]")) === "Online")) {
      expect(li.dataset.type).toBe("online");
    }
  });
});
