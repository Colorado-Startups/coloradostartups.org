// L15 over the built site (run `npm run build` first; test:content does): the
// resource items in /feed.json are exactly the active, non-import records with
// an `added` date, each published at midnight in Denver on that day.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { FeedSchema, ResourceSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { denverMidnight } from "../../../src/components/dispatches/feed";
import { readDist, SITE_DIR } from "../pages";

const DATA = path.resolve(SITE_DIR, "..", "data", "resources");
const records = readdirSync(DATA, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) =>
    readdirSync(path.join(DATA, d.name)).map((f) => ResourceSchema.parse(parse(readFileSync(path.join(DATA, d.name, f), "utf8")))),
  );

describe("resource items in /feed.json", () => {
  const feed = FeedSchema.parse(JSON.parse(readDist("feed.json")));
  const items = feed.items.filter((i) => i._cs.kind === "resource");

  it("are the active records added after the Canvas import that carry an added date", () => {
    const expected = records
      .filter((r) => r.status === "active" && r.source !== "canvas-2026" && r.added)
      .map((r) => `https://coloradostartups.org/ecosystem-canvas/#r-${r.id}`)
      .sort();
    expect(items.map((i) => i.url).sort()).toEqual(expected);
  });

  // Publicus reads this feed, so adding `added` must not change it. Brex and
  // Novo arrived in the Canvas import commit on 2026-10-08 and carry that date.
  it("still list Brex and Novo, dated 2026-10-08", () => {
    for (const id of ["brex", "novo"]) {
      const item = items.find((i) => i.url === `https://coloradostartups.org/ecosystem-canvas/#r-${id}`);
      expect(item, id).toBeDefined();
      expect(item?.date_published, id).toBe(denverMidnight("2026-10-08"));
    }
  });

  it("are dated by added, at midnight in Denver", () => {
    const byId = new Map(records.map((r) => [r.id, r]));
    for (const item of items) {
      const record = byId.get(item.url.split("#r-")[1]!);
      expect(item.date_published, item.id).toBe(denverMidnight(record!.added!));
    }
  });
});
