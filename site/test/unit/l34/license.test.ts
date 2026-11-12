// L34: the license facts in lib/data/license.ts. The built /data/ page is
// checked in test/dom/l34/.
import { RESOURCES_JSON_PATH, ResourceCardSchema, ResourceSchema, toCard } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { orgId } from "../../../src/components/hall/org";
import {
  attributionHtml,
  attributionText,
  CARD_FIELDS,
  DATA_PAGE_PATH,
  DATASET_NAME,
  datasetJsonLd,
  LICENSE,
} from "../../../src/lib/data/license";

const SITE = new URL("https://coloradostartups.org");

const SAMPLE = ResourceSchema.parse({
  id: "example-accelerator",
  name: "Example Accelerator",
  url: "https://example.org/",
  stage: "launch",
  substage: "develop",
  city: "Denver",
  type: "accelerator",
  description: "Denver accelerator for early founders.",
  tags: [],
  source: "canvas-2026",
  status: "active",
  last_checked: "2026-10-18",
});

/** The card keys the /data/ page fails to describe, and the ones it describes that no card has. */
function fieldDrift(cardKeys: readonly string[]): { undocumented: string[]; stale: string[] } {
  const documented = CARD_FIELDS.map((f) => f.key as string);
  return {
    undocumented: cardKeys.filter((k) => !documented.includes(k)),
    stale: documented.filter((k) => !cardKeys.includes(k)),
  };
}

describe("the fields table on /data/", () => {
  it("self-test: flags a card key the page does not describe, and a described key no card has", () => {
    expect(fieldDrift([...CARD_FIELDS.map((f) => f.key), "email"]).undocumented).toEqual(["email"]);
    expect(fieldDrift(CARD_FIELDS.slice(1).map((f) => f.key)).stale).toEqual(["id"]);
  });

  it("describes exactly the fields toCard publishes, in its order", () => {
    const keys = Object.keys(toCard(SAMPLE));
    expect(fieldDrift(keys)).toEqual({ undocumented: [], stale: [] });
    expect(CARD_FIELDS.map((f) => f.key)).toEqual(keys);
    expect(fieldDrift(Object.keys(ResourceCardSchema.shape))).toEqual({ undocumented: [], stale: [] });
  });
});

describe("the credit line", () => {
  it("names the title, the author, the source and the license (CC's TASL)", () => {
    const text = attributionText(SITE);
    expect(text).toBe(
      "Startup Resources by Colorado Startups (https://coloradostartups.org/data/), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).",
    );
    const html = attributionHtml(SITE);
    for (const part of [DATASET_NAME, "Colorado Startups", LICENSE.name, LICENSE.url, `${SITE.origin}${DATA_PAGE_PATH}`]) {
      expect(html).toContain(part);
    }
  });

  it("builds every link from the site origin, so staging credits itself", () => {
    const staging = new URL("https://staging.example.workers.dev");
    expect(attributionText(staging)).toContain("https://staging.example.workers.dev/data/");
    expect(attributionText(staging)).not.toContain("coloradostartups.org");
  });

  it("keeps the house style: no em dashes or spaced en dashes", () => {
    for (const s of [attributionText(SITE), attributionHtml(SITE), ...CARD_FIELDS.map((f) => f.what)]) {
      expect(s).not.toMatch(/—|\s–\s/);
    }
  });
});

describe("the Dataset JSON-LD", () => {
  const ld = datasetJsonLd(SITE, { dateModified: "2026-10-18" });

  it("states the license, the download and the build day", () => {
    expect(ld["@type"]).toBe("Dataset");
    expect(ld.license).toBe(LICENSE.url);
    expect(ld.dateModified).toBe("2026-10-18");
    expect(ld.distribution).toEqual([
      { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `https://coloradostartups.org${RESOURCES_JSON_PATH}` },
    ]);
  });

  it("names Colorado Startups only by the home page's @id", () => {
    for (const key of ["creator", "publisher"]) {
      const ref = ld[key] as Record<string, unknown>;
      expect(ref["@id"]).toBe(orgId(SITE));
      expect(Object.keys(ref).sort()).toEqual(["@id", "@type", "name", "url"]);
    }
  });

  it("states no count, so no figure sits in it without a source", () => {
    expect(JSON.stringify(ld)).not.toMatch(/\b\d{2,}\s+(?:active|listings|resources)\b/);
  });
});
