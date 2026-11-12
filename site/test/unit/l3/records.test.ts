// Contract tests over the committed data: every record file and the review
// report agree with @cs/shared and with each other.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { ResourceSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { IN_ARCHIVE } from "../../archive";
import { dedupeKey } from "../../../../scripts/canvas/lib/url.mjs";
import { FIELD_ORDER, recordYaml } from "../../../../scripts/canvas/lib/yaml.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const DATA = path.join(ROOT, "data/resources");
// ops/ is private: the public export leaves the review report out.
const REPORT = IN_ARCHIVE ? readFileSync(path.join(ROOT, "ops/canvas-review.md"), "utf8") : "";

const files = readdirSync(DATA, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) =>
    readdirSync(path.join(DATA, d.name))
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => ({ stageDir: d.name, file: f, full: path.join(DATA, d.name, f) })),
  );
const records = files.map((f) => ({ ...f, text: readFileSync(f.full, "utf8"), data: parse(readFileSync(f.full, "utf8")) }));

describe("data/resources records", () => {
  it("exist", () => {
    expect(records.length).toBeGreaterThan(0);
  });

  it("each pass ResourceSchema", () => {
    const failures = records
      .map((r) => ({ file: `${r.stageDir}/${r.file}`, result: ResourceSchema.safeParse(r.data) }))
      .filter((x) => !x.result.success)
      .map((x) => `${x.file}: ${x.result.error?.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    expect(failures).toEqual([]);
  });

  it("live in data/resources/<stage>/<id>.yaml", () => {
    const misplaced = records.filter((r) => r.data.stage !== r.stageDir || `${r.data.id}.yaml` !== r.file);
    expect(misplaced.map((r) => `${r.stageDir}/${r.file}`)).toEqual([]);
  });

  it("have unique ids and unique links", () => {
    const ids = records.map((r) => r.data.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = records.map((r) => dedupeKey(r.data.url));
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });

  it("are written in the canonical field order", () => {
    const drifted = records.filter((r) => r.data.source === "canvas-2026" && recordYaml(r.data) !== r.text);
    expect(drifted.map((r) => r.file)).toEqual([]);
    for (const r of records) {
      const keys = Object.keys(r.data);
      expect(keys).toEqual(FIELD_ORDER.filter((k) => keys.includes(k)));
    }
  });

  it("never point at Crunchbase or at Colorado Startups' own pages", () => {
    const bad = records.filter((r) => /crunchbase\.com|coloradostartups\.org/i.test(r.data.url));
    expect(bad.map((r) => r.file)).toEqual([]);
  });

  it("quote last_checked, because Astro's YAML loader reads a bare date as a timestamp", () => {
    const bare = records.filter((r) => /^last_checked: \d/m.test(r.text));
    expect(bare.map((r) => r.file)).toEqual([]);
  });

  it("carry a link-check date when they came from the Canvas", () => {
    const missing = records.filter((r) => r.data.source === "canvas-2026" && !r.data.last_checked);
    expect(missing.map((r) => r.file)).toEqual([]);
  });

  // The import ran this check on its description templates. Records keep
  // their template lines until someone rewrites them, so it runs on the records.
  it("have descriptions that fit the field, with no link and no dash", () => {
    const bad = records.filter(
      (r) => r.data.description.length > 220 || /https?:|www\.|\u2014|\s\u2013\s/.test(r.data.description),
    );
    expect(bad.map((r) => r.file)).toEqual([]);
  });
});

describe.skipIf(!IN_ARCHIVE)("ops/canvas-review.md", () => {
  const count = (label: string) => {
    const m = new RegExp(`^\\| ${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| (\\d+) \\|$`, "m").exec(REPORT);
    return m ? Number(m[1]) : NaN;
  };

  it("agrees with the records on disk", () => {
    const canvas = records.filter((r) => r.data.source === "canvas-2026");
    expect(count("Records, active")).toBe(canvas.filter((r) => r.data.status === "active").length);
    expect(count("Records, waiting for review")).toBe(canvas.filter((r) => r.data.status === "review").length);
  });

  it("accounts for every row: the outcomes add up to the total", () => {
    const rows = [...REPORT.matchAll(/^\| ([^|]+) \| (\d+) \|$/gm)].map((m) => ({ label: m[1], n: Number(m[2]) }));
    const total = rows.find((r) => r.label === "Total");
    expect(total).toBeDefined();
    const sum = rows.filter((r) => r.label !== "Total").reduce((a, r) => a + r.n, 0);
    expect(sum).toBe(total?.n);
    expect(count("Unclear: heading not in the taxonomy")).toBe(0);
  });

  it("lists every review record with its reason", () => {
    for (const r of records.filter((x) => x.data.status === "review")) expect(REPORT).toContain(`\`${r.data.id}\``);
  });

  it("keeps the house style: no em dashes", () => {
    expect(REPORT).not.toMatch(/\u2014|\s\u2013\s/);
  });
});
