// The sitemap lastmod helper (GO-LIVE item B8), against a fixture data/
// folder in a temp directory and then against the repo's own data/.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { tempDirs } from "../temp-dirs";
import { calendarDate, dataDates, lastmodSerializer } from "../../../src/lib/seo/lastmod.mjs";

const tempDir = tempDirs();

const REPO_DATA = path.resolve(import.meta.dirname, "../../../../data");

function fixtureData(files: Record<string, string>): string {
  const dir = tempDir("lastmod-data-");
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

const md = (front: string) => `---\n${front}\n---\n\nBody text.\n`;

describe("calendarDate", () => {
  it("keeps a plain date and the day of an ISO datetime", () => {
    expect(calendarDate("2026-10-06")).toBe("2026-10-06");
    expect(calendarDate("2026-10-06T09:30:00-06:00")).toBe("2026-10-06");
    expect(calendarDate(new Date("2026-10-18T00:00:00Z"))).toBe("2026-10-18");
  });

  it("returns null for anything that is not a real date", () => {
    for (const v of ["2026-02-30", "Oct 6, 2026", "2026-10", "", null, undefined, 20261006, new Date("nope")]) {
      expect(calendarDate(v), String(v)).toBeNull();
    }
  });
});

describe("dataDates", () => {
  it("dates each dispatch, the dispatch index, the privacy policy and the Leaderboard", () => {
    const dir = fixtureData({
      "dispatches/2026-10-06-first.md": md("title: First\ndate: 2026-10-06\nsummary: s"),
      "dispatches/2026-10-12-second.md": md('title: Second\ndate: "2026-10-12"\nsummary: s'),
      "legal/privacy.md": md("title: Privacy Policy\nupdated: 2026-10-18\nsummary: s"),
      "leaderboard/editions/2025-board.yaml": 'id: 2025-board\npublished: "2025-11-01"\n',
      "leaderboard/editions/2026-honorees.yaml": 'id: 2026-honorees\npublished: "2026-10-18"\n',
    });
    expect(Object.fromEntries(dataDates(dir))).toEqual({
      "/dispatches/2026-10-06-first/": "2026-10-06",
      "/dispatches/2026-10-12-second/": "2026-10-12",
      "/dispatches/": "2026-10-12",
      "/privacy/": "2026-10-18",
      "/leaderboard/": "2026-10-18",
    });
  });

  it("leaves out a page whose data has no date, a bad date or no front matter", () => {
    const dir = fixtureData({
      "dispatches/no-date.md": md("title: No date\nsummary: s"),
      "dispatches/bad-date.md": md("title: Bad\ndate: 2026-02-30"),
      "dispatches/no-front-matter.md": "Just text.\n",
      "legal/privacy.md": md("title: Privacy Policy\nupdated: soon"),
      "leaderboard/editions/broken.yaml": "id: [unclosed\n",
    });
    expect(dataDates(dir).size).toBe(0);
  });

  it("returns an empty map, without throwing, when the data folder is missing", () => {
    expect(dataDates(path.join(tmpdir(), "no-such-data-folder-l31")).size).toBe(0);
  });

  it("reads the repo's data/ by default, with a date for every dispatch", () => {
    const dates = dataDates();
    for (const f of readdirSync(path.join(REPO_DATA, "dispatches")).filter((n) => n.endsWith(".md"))) {
      const front = parse(readFileSync(path.join(REPO_DATA, "dispatches", f), "utf8").split(/^---$/m)[1] ?? "");
      expect(dates.get(`/dispatches/${f.replace(/\.md$/, "")}/`), f).toBe(String(front.date).slice(0, 10));
    }
    const privacy = parse(readFileSync(path.join(REPO_DATA, "legal/privacy.md"), "utf8").split(/^---$/m)[1] ?? "");
    expect(dates.get("/privacy/")).toBe(String(privacy.updated).slice(0, 10));
    expect(dates.get("/leaderboard/")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("lastmodSerializer", () => {
  const serialize = lastmodSerializer(new Map([["/dispatches/2026-10-06-first/", "2026-10-06"]]));

  it("sets lastmod from the data date and keeps the other fields", () => {
    expect(serialize({ url: "https://coloradostartups.org/dispatches/2026-10-06-first/", changefreq: "weekly" } as { url: string })).toEqual({
      url: "https://coloradostartups.org/dispatches/2026-10-06-first/",
      changefreq: "weekly",
      lastmod: "2026-10-06",
    });
  });

  it("removes any lastmod from a page with no data date, so the build time never lands", () => {
    const out = serialize({ url: "https://coloradostartups.org/team/", lastmod: new Date().toISOString() });
    expect(out).toEqual({ url: "https://coloradostartups.org/team/" });
    expect("lastmod" in out).toBe(false);
  });
});
