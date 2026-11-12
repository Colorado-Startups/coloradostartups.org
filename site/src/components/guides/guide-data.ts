// Build-time input for /guides/: the active Startup Resources records with
// their tags, the regions in display order, the build date in Denver, and the
// event calendar snapshot. Owner: L23; L32 added the calendar. Only
// `status: active` records are public, as on the directory.
import { toCard } from "@cs/shared";
import { getCollection } from "astro:content";

import { asOf, type GuideInput } from "../../lib/guides/guides";
import { REGIONS } from "../../lib/regions/match";
import { SNAPSHOT } from "../events/events";

// Read once per build, so every guide states the same date and the events
// guide drops the same past events on every page.
const NOW = new Date();
const BUILT = asOf(NOW);

export async function guideInput(): Promise<GuideInput> {
  const entries = await getCollection("resources", (e) => e.data.status === "active");
  const records = entries
    .map((e) => ({ ...toCard(e.data), tags: e.data.tags }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  const regions = [...REGIONS];
  return { records, regions, date: BUILT, calendar: { snapshot: SNAPSHOT, now: NOW } };
}
