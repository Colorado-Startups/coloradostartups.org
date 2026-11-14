import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isCurrent, parseSponsors, README_TIERS, shownSponsors } from "../../../src/lib/sponsors";

// The GitHub Sponsors rewards: data/sponsors/sponsors.yaml as /sponsors/ and
// README.md must deliver them.
const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const row = (over: Record<string, string>) =>
  `- { name: ${over.name ?? "A"}, url: "https://a.example", tier: ${over.tier ?? "trail-supporter"}, since: "${over.since ?? "2026-11-13"}"${over.logo ? `, logo: ${over.logo}` : ""} }`;

describe("parseSponsors", () => {
  it("reads the empty file as no sponsors (known clean)", () => {
    expect(parseSponsors("# comments only\n[]")).toEqual([]);
    expect(parseSponsors("# comments only\n")).toEqual([]);
  });

  it("refuses a Peak Partner without a logo, a logo on any other tier, and a repeated name (known bad)", () => {
    expect(() => parseSponsors(row({ tier: "peak-partner" }))).toThrow(/logo/);
    expect(() => parseSponsors(row({ logo: "/sponsor-logos/a.svg" }))).toThrow(/logo/);
    expect(() => parseSponsors(`${row({})}\n${row({})}`)).toThrow(/repeats/);
    expect(parseSponsors(row({ tier: "peak-partner", logo: "/sponsor-logos/a.svg" }))).toHaveLength(1);
  });
});

describe("shownSponsors", () => {
  it("shows a one-time sponsor for a year, and orders by tier then since", () => {
    const rows = parseSponsors(
      [
        row({ name: "Old", tier: "one-time-25", since: "2025-11-13" }),
        row({ name: "Trail", since: "2026-01-01" }),
        row({ name: "Summit", tier: "summit-sponsor", since: "2026-06-01" }),
      ].join("\n"),
    );
    expect(isCurrent(rows[0], "2026-11-12")).toBe(true);
    expect(shownSponsors(rows, "2026-11-13").map((s) => s.name)).toEqual(["Summit", "Trail"]);
  });
});

describe("data/sponsors/sponsors.yaml", () => {
  const rows = parseSponsors(read("data/sponsors/sponsors.yaml"));
  const readme = read("README.md");

  it("puts every Summit, Peak and one-time-100 sponsor in README.md under Sponsors", () => {
    const section = readme.slice(readme.indexOf("## Sponsors"), readme.indexOf("## License"));
    for (const s of rows.filter((r) => README_TIERS.includes(r.tier))) expect(section).toContain(`[${s.name}](${s.url})`);
  });

  it("has every logo file in site/public/", () => {
    for (const s of rows.filter((r) => r.logo)) expect(existsSync(path.join(ROOT, "site/public", s.logo!)), s.logo).toBe(true);
  });
});
