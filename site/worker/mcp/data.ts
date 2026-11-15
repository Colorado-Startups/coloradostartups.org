// The open data the /mcp tools read: the five /data/*.json files the site
// build writes, fetched through the ASSETS binding and validated with the
// shared schemas. Read once per isolate; a deploy brings new assets and a new
// isolate. A missing or malformed file reads as an empty list, and a failed
// read is not kept, so the next request tries again.
import {
  COMPANIES_JSON_PATH,
  EVENTS_JSON_PATH,
  GUIDES_JSON_PATH,
  OpenCompanySchema,
  OpenEventSchema,
  OpenGuideSchema,
  OpenRegionSchema,
  REGIONS_JSON_PATH,
  ResourceCardSchema,
  RESOURCES_JSON_PATH,
  type OpenCompany,
  type OpenEvent,
  type OpenGuide,
  type OpenRegion,
  type ResourceCard,
} from "@cs/shared";
import * as z from "zod";

import { errText } from "../lib/errors";

export interface OpenData {
  resources: readonly ResourceCard[];
  companies: readonly OpenCompany[];
  events: readonly OpenEvent[];
  guides: readonly OpenGuide[];
  regions: readonly OpenRegion[];
}

export type AssetsFetcher = Pick<Fetcher, "fetch">;

async function readList<T>(assets: AssetsFetcher, path: string, schema: z.ZodType<T>): Promise<T[]> {
  const res = await assets.fetch(new Request(`https://assets.invalid${path}`));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const parsed = z.array(schema).safeParse(await res.json());
  if (!parsed.success) throw new Error(`${path}: does not match its schema`);
  return parsed.data;
}

/** Reads every file. Throws when one cannot be read, so nothing half-loaded is kept. */
async function readOpenData(assets: AssetsFetcher): Promise<OpenData> {
  const [resources, companies, events, guides, regions] = await Promise.all([
    readList(assets, RESOURCES_JSON_PATH, ResourceCardSchema),
    readList(assets, COMPANIES_JSON_PATH, OpenCompanySchema),
    readList(assets, EVENTS_JSON_PATH, OpenEventSchema),
    readList(assets, GUIDES_JSON_PATH, OpenGuideSchema),
    readList(assets, REGIONS_JSON_PATH, OpenRegionSchema),
  ]);
  return { resources, companies, events, guides, regions };
}

const NO_DATA: OpenData = { resources: [], companies: [], events: [], guides: [], regions: [] };

let cached: Promise<OpenData> | null = null;

/** The open data, read once per isolate. When a read fails, the tools answer from empty lists. */
export function loadOpenData(assets: AssetsFetcher | undefined): Promise<OpenData> {
  if (!assets) return Promise.resolve(NO_DATA);
  cached ??= readOpenData(assets).catch((err: unknown) => {
    console.error("mcp: open data unavailable:", errText(err));
    cached = null;
    return NO_DATA;
  });
  return cached;
}
