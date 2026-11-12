// L9 over the built site: /dispatches/, each dispatch page, /feed.json and
// /rss.xml. feed.json must parse with FeedSchema, because Publicus's drafting
// pipeline reads it; rss.xml must be well-formed RSS 2.0.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { DwarfSchema, FeedSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { readDist, SITE_DIR } from "../pages";
import { axeViolations } from "./axe";

const DATA = path.resolve(SITE_DIR, "..", "data");
// Dispatch ids with their frontmatter dates, newest first (ties by id).
const dispatches = readdirSync(path.join(DATA, "dispatches"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => {
    const md = readFileSync(path.join(DATA, "dispatches", f), "utf8");
    const date = /^date:\s*"?(\d{4}-\d{2}-\d{2})/m.exec(md)?.[1] ?? "";
    return { id: f.slice(0, -3), date };
  })
  .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
const dispatchIds = dispatches.map((d) => d.id);
// Resource id to its source, across every stage folder.
const resourceSource = new Map(
  readdirSync(path.join(DATA, "resources"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) =>
      readdirSync(path.join(DATA, "resources", d.name)).map((f) => {
        const r = parse(readFileSync(path.join(DATA, "resources", d.name, f), "utf8")) as { id: string; source: string };
        return [r.id, r.source] as const;
      }),
    ),
);
const publicus = (parse(readFileSync(path.join(DATA, "team", "dwarves.yaml"), "utf8")) as unknown[])
  .map((d) => DwarfSchema.parse(d))
  .find((d) => d.id === "publicus")!;

const html = (s: string) => new DOMParser().parseFromString(s, "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("/feed.json", () => {
  const raw = JSON.parse(readDist("feed.json"));
  const feed = FeedSchema.parse(raw);

  it("parses with FeedSchema and points at itself", () => {
    expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
    expect(feed.feed_url).toBe("https://coloradostartups.org/feed.json");
  });

  it("emits every dispatch, at its own page", () => {
    const urls = feed.items.filter((i) => i._cs.kind === "dispatch").map((i) => i.url);
    expect(urls.sort()).toEqual(dispatchIds.map((id) => `https://coloradostartups.org/dispatches/${id}/`).sort());
  });

  it("lists items newest first, with unique ids", () => {
    const dates = feed.items.map((i) => Date.parse(i.date_published));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
    expect(new Set(feed.items.map((i) => i.id)).size).toBe(feed.items.length);
  });

  it("sends plain text, not Markdown, in content_text", () => {
    for (const item of feed.items) expect(item.content_text, item.id).not.toMatch(/\]\(|^#+\s|\*\*/m);
  });

  it("emits Leaderboard editions when there are any", () => {
    const editions = readdirSync(path.join(DATA, "leaderboard", "editions")).filter((f) => f.endsWith(".yaml"));
    expect(feed.items.filter((i) => i._cs.kind === "edition")).toHaveLength(editions.length);
  });

  it("leaves the canvas-2026 import out of the feed", () => {
    for (const item of feed.items.filter((i) => i._cs.kind === "resource")) {
      const id = item.url.split("#r-")[1]!;
      expect(resourceSource.has(id), id).toBe(true);
      expect(resourceSource.get(id), id).not.toBe("canvas-2026");
    }
  });
});

describe("/rss.xml", () => {
  const xml = new DOMParser().parseFromString(readDist("rss.xml"), "application/xml");
  const feed = FeedSchema.parse(JSON.parse(readDist("feed.json")));

  it("is well-formed RSS 2.0 with a channel title, link, description and self link", () => {
    expect(xml.querySelector("parsererror")).toBeNull();
    expect(xml.documentElement.getAttribute("version")).toBe("2.0");
    const channel = xml.querySelector("rss > channel")!;
    for (const tag of ["title", "link", "description"]) expect(text(channel.querySelector(`:scope > ${tag}`)), tag).not.toBe("");
    const self = channel.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "link")[0];
    expect(self?.getAttribute("rel")).toBe("self");
    expect(self?.getAttribute("href")).toBe("https://coloradostartups.org/rss.xml");
  });

  it("carries the same items as feed.json, each with title, link, guid and an RFC 822 date", () => {
    const items = [...xml.querySelectorAll("channel > item")];
    expect(items.map((i) => text(i.querySelector("guid")))).toEqual(feed.items.map((i) => i.id));
    for (const item of items) {
      expect(text(item.querySelector("title"))).not.toBe("");
      expect(text(item.querySelector("link"))).toMatch(/^https:\/\/coloradostartups\.org\//);
      expect(text(item.querySelector("pubDate"))).toMatch(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
    }
  });
});

describe("/dispatches/", () => {
  const page = html(readDist("dispatches/index.html"));

  it("links every dispatch, newest first", () => {
    const links = [...page.querySelectorAll<HTMLAnchorElement>("[data-dispatch] h3 a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(dispatchIds.map((id) => `/dispatches/${id}/`));
  });

  it("names Publicus with its disclosure in full", () => {
    expect(text(page.querySelector("main [data-disclosure]"))).toBe(publicus.disclosure);
  });

  it("links both feeds", () => {
    expect(page.querySelector("main a[href='/rss.xml']")).not.toBeNull();
    expect(page.querySelector("main a[href='/feed.json']")).not.toBeNull();
  });

  it("passes axe (structure and ARIA)", async () => {
    expect(await axeViolations(readDist("dispatches/index.html"))).toEqual([]);
  });
});

describe("each dispatch page", () => {
  for (const id of dispatchIds) {
    it(`renders ${id} with its title, date and a way back`, async () => {
      const source = readDist(`dispatches/${id}/index.html`);
      const page = html(source);
      expect(text(page.querySelector("main h1"))).not.toBe("");
      expect(page.querySelector("main time[datetime]")?.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(page.querySelector("main a[href='/dispatches/']")).not.toBeNull();
      const ld = JSON.parse(page.querySelector("script[type='application/ld+json']")?.textContent ?? "{}");
      expect(ld["@type"]).toBe("BlogPosting");
      expect(await axeViolations(source)).toEqual([]);
    });
  }
});
