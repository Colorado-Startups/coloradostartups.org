// L15: Startup Resources in /feed.json and /rss.xml are dated by the record's
// optional `added` date, never by last_checked, and a record without `added`
// stays out of the feed.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { type Resource, ResourceSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { buildFeed, resourceEntries } from "../../../src/components/dispatches/feed";

const resource = (over: Partial<Resource> = {}): Resource => ({
  id: "acme-coworking",
  name: "Acme Coworking",
  url: "https://acme.example/",
  stage: "launch",
  substage: "service-providers",
  city: "Denver",
  type: "coworking",
  description: "Coworking space in Denver with a founder community and event space.",
  tags: ["coworking"],
  source: "suggestion",
  status: "active",
  last_checked: "2026-10-18",
  added: "2026-10-12",
  ...over,
});

describe("ResourceSchema.added", () => {
  it("is optional, so every record that has none still parses", () => {
    const { added: _drop, ...rest } = resource();
    expect(ResourceSchema.parse(rest).added).toBeUndefined();
  });

  it("takes a calendar date as text, like last_checked", () => {
    expect(ResourceSchema.parse(resource()).added).toBe("2026-10-12");
    expect(ResourceSchema.safeParse(resource({ added: "2026-13-01" })).success).toBe(false);
    expect(ResourceSchema.safeParse(resource({ added: "October 12" })).success).toBe(false);
  });
});

describe("resourceEntries", () => {
  it("dates a resource by added, not by last_checked", () => {
    const [entry] = resourceEntries([resource()]);
    expect(entry?.date).toBe("2026-10-12");
  });

  it("leaves out a record with no added date, even when it has last_checked", () => {
    expect(resourceEntries([resource({ added: undefined })])).toEqual([]);
  });

  it("leaves out the canvas-2026 import and records that are not active", () => {
    const out = resourceEntries([
      resource({ id: "from-canvas", source: "canvas-2026" }),
      resource({ id: "in-review", status: "review" }),
      resource({ id: "gone", status: "dead" }),
      resource({ id: "from-cs", source: "cs" }),
    ]);
    expect(out.map((e) => e.path)).toEqual(["/ecosystem-canvas/#r-from-cs"]);
  });

  it("builds the entry the feed has always carried", () => {
    expect(resourceEntries([resource()])).toEqual([
      {
        kind: "resource",
        path: "/ecosystem-canvas/#r-acme-coworking",
        title: "Acme Coworking",
        summary: "Coworking space in Denver with a founder community and event space.",
        text: "Acme Coworking. Coworking space in Denver with a founder community and event space.",
        date: "2026-10-12",
        tags: ["startup-resources", "launch", "coworking", "coworking"],
      },
    ]);
  });

  it("publishes at midnight in Denver on the added day", () => {
    const feed = buildFeed(resourceEntries([resource()]), new URL("https://coloradostartups.org"));
    expect(feed.items[0]?.date_published).toBe("2026-10-12T00:00:00-06:00");
  });
});

// Astro's YAML loader reads a bare 2026-10-12 as a timestamp, and the schema
// wants text, so `added` is quoted the way L3 quotes last_checked.
describe("data/resources records", () => {
  const dir = path.resolve(import.meta.dirname, "../../../../data/resources");
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(path.join(dir, d.name)).map((f) => path.join(d.name, f)));

  it("quote added", () => {
    const bare = files.filter((f) => /^added: \d/m.test(readFileSync(path.join(dir, f), "utf8")));
    expect(bare).toEqual([]);
  });
});
