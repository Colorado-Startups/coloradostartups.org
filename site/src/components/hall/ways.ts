// The four ways into the community, as the home page's WaysIn cards show
// them, and the outside links /links/ lists. Owner: L1. Every href comes from
// WAYS_IN in @cs/shared, so a way in cannot point somewhere new without a
// reviewed change there. The Slack sign-up form's URL lives only in
// ops/redirects/map.csv, behind WAYS_IN.slack (#128).
import { WAYS_IN } from "@cs/shared";

import { CHANNELS } from "./channels";

export const LINKEDIN_GROUP_URL = WAYS_IN["linkedin-group"];
export const LINKEDIN_PAGE_URL = WAYS_IN["linkedin-page"];

export interface WayIn {
  kind: "slack" | "linkedin-group" | "linkedin-page" | "newsletter";
  name: string;
  href: string;
  /** Link text that says exactly what happens. */
  action: string;
  what: string;
}

// The four ways in, in the order the home page lists them. Each takes its
// name, action and copy from its channel in channels.ts, so the home page and
// /community/ say the same thing.
const WAY_KINDS: readonly WayIn["kind"][] = ["slack", "linkedin-group", "linkedin-page", "newsletter"];

export const WAYS: readonly WayIn[] = WAY_KINDS.map((kind) => {
  const channel = CHANNELS.find((c) => c.id === kind);
  if (!channel) throw new Error(`channels.ts has no "${kind}" channel for the home page's ways in`);
  return { kind, name: channel.name, href: channel.action.href, action: channel.action.label, what: channel.expect };
});
