// The content gate over event text, run for real through cs_site_lint.py,
// with a known-bad and a known-clean event; and the fetch script's exit
// contract: 0 written, 2 usage, 3 could not check with the snapshot kept.
// The feed is a fake fetch, never the network.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSnapshot, calendarConfig, feedUrl, main, refresh } from "../../../../scripts/events/fetch-ics.mjs";
import { CouldNotLint, dropReason, lintSources, termRuleIds } from "../../../../scripts/events/lib/lint.mjs";
import { CALENDAR_ID, CALENDAR_TIMEZONE } from "../../../src/components/info/links";

const ROOT = path.resolve(import.meta.dirname, "../../../..");

// Temp folders the tests make; afterEach removes them, so a run leaves none.
const made: string[] = [];
const removed: string[] = [];
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
  }
});
const hasPython = spawnSync("python3", ["--version"]).status === 0;
const NOW = new Date("2026-10-18T18:00:00Z");
const CALENDAR = { id: "test@group.calendar.google.com", timeZone: CALENDAR_TIMEZONE };

const feed = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.map((e) => `BEGIN:VEVENT\n${e.trim()}\nEND:VEVENT`), "END:VCALENDAR"].join("\r\n");

const CLEAN = `UID:clean@test
DTSTART;TZID=America/Denver:20261021T180000
DTEND;TZID=America/Denver:20261021T200000
RRULE:FREQ=WEEKLY;COUNT=2
SUMMARY:Founder Coffee — Denver
LOCATION:Enterprise Coworking RiNo\\, 3000 Lawrence St\\, Denver\\, CO 80205\\, USA
DESCRIPTION:Coffee for founders.\\nRSVP at https://lu.ma/founder-coffee`;

// A banned phrase sits in the description, which the page never shows: the
// event still stays off, because its link would lead there. The sample uses a
// public rule; the private avoid list never appears in tests (#552).
const AVOID = `UID:avoid@test
DTSTART:20261023T010000Z
DTEND:20261023T030000Z
SUMMARY:Fireside chat
LOCATION:Online
DESCRIPTION:Why Denver is the Silicon Valley of the Rockies.`;

const ELECTION = `UID:election@test
DTSTART:20261030T000000Z
SUMMARY:Go vote watch party
LOCATION:ID345\\, 3960 High St\\, Denver\\, CO 80205`;

const LINKED = `UID:linked@test
DTSTART:20261121T010000Z
SUMMARY:AI builders night
LOCATION:Online
URL:https://coloradoai.us/events/builders`;

const SEEDED = feed(CLEAN, AVOID, ELECTION, LINKED);

const titles = (events: { title: string }[]) => [...new Set(events.map((e) => e.title))];

describe("dropReason", () => {
  const terms = new Set(["silicon-valley-of", "election-word"]);

  it("drops on any term rule, FAIL or WARN, wherever it is", () => {
    expect(dropReason([{ severity: "WARN", check: "election-word", message: "", line: 9 }], terms)).toBe("election-word (WARN)");
    expect(dropReason([{ severity: "FAIL", check: "silicon-valley-of", message: "", line: 4 }], terms)).toBe("silicon-valley-of (FAIL)");
  });

  it("drops on a prose FAIL only on a line the page shows", () => {
    expect(dropReason([{ severity: "FAIL", check: "em-dash", message: "", line: 1 }], terms)).toBe("em-dash (FAIL)");
    expect(dropReason([{ severity: "FAIL", check: "em-dash", message: "", line: 5 }], terms)).toBeNull();
    expect(dropReason([{ severity: "WARN", check: "hedge-word", message: "", line: 1 }], terms)).toBeNull();
  });
});

describe.skipIf(!hasPython)("the content gate on event text (real cs_site_lint.py)", () => {
  const run = (now: Date) => buildSnapshot(SEEDED, { now, timeZone: CALENDAR_TIMEZONE, source: "test", repoRoot: ROOT });

  it("keeps the clean event, with its em dash turned into a comma", () => {
    const { snapshot } = run(NOW);
    const kept = snapshot.events.filter((e: { title: string }) => e.title === "Founder Coffee, Denver");
    expect(kept.map((e: { start: string }) => e.start)).toEqual(["2026-10-21T18:00:00-06:00", "2026-10-28T18:00:00-06:00"]);
    expect(kept[0]).toMatchObject({
      allDay: false,
      end: "2026-10-21T20:00:00-06:00",
      location: "Enterprise Coworking RiNo, 3000 Lawrence St, Denver, CO 80205, USA",
      url: "https://lu.ma/founder-coffee",
      inPerson: true,
    });
  });

  it("drops the avoid-list event and the election event, and says which rule", () => {
    const { snapshot, dropped } = run(NOW);
    expect(titles(snapshot.events)).toEqual(["Founder Coffee, Denver"]);
    const why = Object.fromEntries(dropped.map((d: { title: string; reason: string }) => [d.title, d.reason]));
    expect(why["Fireside chat"]).toContain("silicon-valley-of (FAIL)");
    expect(why["Go vote watch party"]).toContain("election-phrase (FAIL)");
  });

  it("drops a coloradoai.us link through Nov 10, 2026 and keeps it from Nov 11", () => {
    expect(run(NOW).dropped.map((d: { title: string }) => d.title)).toContain("AI builders night");
    const later = run(new Date("2026-11-11T18:00:00Z"));
    expect(titles(later.snapshot.events)).toContain("AI builders night");
  });

  it("finds the term rule ids in the rules file", () => {
    const ids = termRuleIds(ROOT);
    for (const id of ["silicon-valley-of", "election-phrase", "coloradoai-link", "placeholder"]) expect(ids.has(id)).toBe(true);
    expect(ids.has("em-dash")).toBe(false);
  });
});

describe("could not check", () => {
  const sources = [{ title: "A", location: null, url: null, description: "" }];

  it("throws when python is missing", () => {
    expect(() => lintSources(sources, { repoRoot: ROOT, python: "no-such-python-cs" })).toThrow(CouldNotLint);
  });

  it("throws when the gate checks fewer files than it was given", () => {
    // A gate whose scope skipped data/events/ would report every event clean.
    const dir = tempDir("cs-events-fake-");
    const fake = path.join(dir, "fake-lint.sh");
    writeFileSync(fake, '#!/bin/sh\necho "cs_site_lint: 0 file(s) checked, 0 FAIL, 0 WARN"\nexit 0\n');
    chmodSync(fake, 0o755);
    expect(() => lintSources(sources, { repoRoot: ROOT, python: fake })).toThrow(/checked 0 of 1 files/);
  });
});

describe("refresh and main", () => {
  const tmpOut = () => {
    const out = path.join(tempDir("cs-events-"), "upcoming.json");
    writeFileSync(out, "the committed snapshot\n");
    return out;
  };
  const answer = (body: string, init: ResponseInit = {}) =>
    vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "text/calendar; charset=utf-8" }, ...init }));
  const quiet = () => {};

  it.skipIf(!hasPython)("writes the snapshot and exits 0", async () => {
    const out = tmpOut();
    const fetchImpl = answer(SEEDED);
    expect(await refresh({ fetchImpl, now: NOW, out, calendar: CALENDAR, log: quiet })).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(feedUrl(CALENDAR.id), expect.anything());
    const snapshot = JSON.parse(readFileSync(out, "utf8"));
    expect(snapshot).toMatchObject({ timeZone: "America/Denver", windowDays: 60, fetchedAt: NOW.toISOString() });
    expect(titles(snapshot.events)).toEqual(["Founder Coffee, Denver"]);
  });

  const unchanged = [
    ["the network fails", vi.fn(async () => Promise.reject(new TypeError("fetch failed")))],
    ["the feed answers 404", answer("Not Found", { status: 404, headers: { "content-type": "text/html" } })],
    ["the feed answers HTML", answer("<!doctype html>", { headers: { "content-type": "text/html" } })],
    ["the feed is not a calendar", answer("hello")],
  ] as const;

  it.each(unchanged)("exits 3 and keeps the snapshot when %s", async (_, fetchImpl) => {
    const out = tmpOut();
    const lines: string[] = [];
    const code = await refresh({ fetchImpl, now: NOW, out, calendar: CALENDAR, log: (l: string) => lines.push(l) });
    expect(code).toBe(3);
    expect(readFileSync(out, "utf8")).toBe("the committed snapshot\n");
    expect(lines.join("\n")).toMatch(/could not check/);
  });

  it("exits 3 and keeps the snapshot when the content gate cannot run", async () => {
    const out = tmpOut();
    const code = await refresh({ fetchImpl: answer(SEEDED), now: NOW, out, calendar: CALENDAR, python: "no-such-python-cs", log: quiet });
    expect(code).toBe(3);
    expect(readFileSync(out, "utf8")).toBe("the committed snapshot\n");
  });

  it("skips the feed in --prebuild unless Workers Builds or CS_EVENTS_FETCH asks for it", async () => {
    const fetchImpl = answer(SEEDED);
    const out = tmpOut();
    expect(await main(["--prebuild"], {}, { fetchImpl, out, log: quiet })).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    const code = await main(["--prebuild"], { WORKERS_CI: "1" }, { fetchImpl, out, now: NOW, calendar: CALENDAR, log: quiet });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(code).toBe(hasPython ? 0 : 3);
  });

  it("exits 2 on an unknown option", async () => {
    expect(await main(["--url", "https://example.org/feed.ics"], {}, { log: quiet })).toBe(2);
  });

  it("reads only the fixed feed of the site's calendar", async () => {
    expect(await calendarConfig()).toEqual({ id: CALENDAR_ID, timeZone: CALENDAR_TIMEZONE });
    expect(feedUrl(CALENDAR_ID)).toBe(
      `https://calendar.google.com/calendar/ical/${encodeURIComponent(CALENDAR_ID)}/public/basic.ics`,
    );
  });
});

// Runs last: every temp folder a test above made is gone (#309).
it("leaves no temp folder behind", () => {
  expect(removed.length).toBeGreaterThan(0);
  expect(removed.filter((dir) => existsSync(dir))).toEqual([]);
});
