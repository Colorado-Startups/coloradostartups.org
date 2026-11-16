// The click events the site may send to POST /api/e, and the only prop keys
// each may carry. One list for both sides: the Worker route
// (site/worker/routes/e.ts) refuses any other name, and the page helper
// (site/src/lib/track.ts) sends no other name, so the two cannot drift.
//
// No zod and no other import: the page helper loads this file directly, so
// it must stay a few hundred bytes in the browser bundle.

// The 12 events, each with at most two prop keys. No key holds free text:
// search_used sends a result count, never the query.
export const EVENT_PROPS = {
  join_click: ["where"],
  join_submit: ["where", "ok"],
  newsletter_submit: ["where", "ok"],
  ask_used: ["where", "kind"],
  search_used: ["where", "results"],
  connect_copy: ["where", "target"],
  connect_click: ["where", "target"],
  door_pick: ["where", "door"],
  map_region_open: ["where", "region"],
  resource_out: ["where", "resource"],
  event_out: ["where", "source"],
  step_done: ["where", "step"],
} as const satisfies Record<string, readonly string[]>;

export type EventName = keyof typeof EVENT_PROPS;
export const EVENT_NAMES = Object.keys(EVENT_PROPS) as EventName[];

// A string prop must be a short slug: no spaces, "@", ".", "?" or capitals, so
// no email, URL, name or search text fits.
export const PROP_TOKEN = /^[a-z0-9_-]{1,40}$/;

export type PropValue = string | number | boolean;

export function isEventName(name: unknown): name is EventName {
  return typeof name === "string" && Object.hasOwn(EVENT_PROPS, name);
}

// Keeps only the keys EVENT_PROPS lists for this event, with a slug, a finite
// number or a boolean as the value. Everything else is dropped, "$" keys
// ($ip among them) included, since no event lists one.
export function cleanProps(name: EventName, raw: unknown): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const props = raw as Record<string, unknown>;
  for (const key of EVENT_PROPS[name]) {
    if (!Object.hasOwn(props, key)) continue;
    const value = props[key];
    if (typeof value === "string" && PROP_TOKEN.test(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}
