// The license on Startup Resources data (GO-LIVE C9, decision 70: CC BY 4.0).
// Pure, with no Astro imports: /data/ renders these facts, and
// test/unit/l34/license.test.ts checks them in plain Node.
//
// One source for the license words. The /data/ page, its Dataset JSON-LD and
// the attribution text people copy all read from here, so they cannot drift.
import { RESOURCES_JSON_PATH } from "@cs/shared";

import { ORG_NAME, organizationRef } from "../../components/hall/org";

export const DATA_PAGE_PATH = "/data/";

export const DATASET_NAME = "Startup Resources";

const DATASET_DESCRIPTION =
  "Colorado programs, events, investors, service providers and support for founders, sorted by company stage.";

export const LICENSE = {
  name: "CC BY 4.0",
  title: "Creative Commons Attribution 4.0 International",
  url: "https://creativecommons.org/licenses/by/4.0/",
} as const;

/** The fields every listing in /data/resources.json carries, in toCard's order. */
export const CARD_FIELDS = [
  { key: "id", what: "a stable id, also the anchor r-<id> on Startup Resources" },
  { key: "name", what: "the organization or program name" },
  { key: "url", what: "its own website" },
  { key: "stage", what: "idea, launch, growth or support" },
  { key: "substage", what: "the group within that stage" },
  { key: "city", what: "the Colorado city, or statewide or online" },
  { key: "type", what: "the resource type, such as accelerator or investor" },
  { key: "description", what: "one sentence Colorado Startups wrote about it" },
] as const;

/** Title, author, source and license: the credit CC asks for, as plain text. */
export function attributionText(site: URL): string {
  const page = new URL(DATA_PAGE_PATH, site).toString();
  return `${DATASET_NAME} by ${ORG_NAME} (${page}), licensed under ${LICENSE.name} (${LICENSE.url}).`;
}

/** The same credit as HTML, for a page footer or a dataset README. */
export function attributionHtml(site: URL): string {
  const page = new URL(DATA_PAGE_PATH, site).toString();
  const home = new URL("/", site).toString();
  return `<a href="${page}">${DATASET_NAME}</a> by <a href="${home}">${ORG_NAME}</a>, licensed under <a href="${LICENSE.url}">${LICENSE.name}</a>.`;
}

/**
 * The schema.org Dataset for /data/. Colorado Startups appears only as
 * organizationRef, so the home page stays the one place its facts live (the
 * L15 entity-graph test). `dateModified` is the build day in Denver.
 */
export function datasetJsonLd(site: URL, opts: { dateModified: string }): Record<string, unknown> {
  const abs = (path: string) => new URL(path, site).toString();
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: DATASET_NAME,
    description: DATASET_DESCRIPTION,
    url: abs(DATA_PAGE_PATH),
    license: LICENSE.url,
    isAccessibleForFree: true,
    creator: organizationRef(site),
    publisher: organizationRef(site),
    spatialCoverage: { "@type": "Place", name: "Colorado" },
    dateModified: opts.dateModified,
    distribution: [
      { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: abs(RESOURCES_JSON_PATH) },
    ],
  };
}
