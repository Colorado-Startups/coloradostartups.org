// POST /api/e: one anonymous click event from our own pages, forwarded to
// PostHog. Owner: M1a (engagement plan).
//
// What reaches PostHog: the event name (one of EVENT_PROPS), the props that
// event lists (slugs, numbers or booleans only),
// a distinct_id that changes every UTC day (lib/anon-id.ts), and two flags:
// $process_person_profile false (no person profile) and $geoip_disable true
// (no location). What never does: the visitor IP, cookies, the User-Agent,
// the Referer, free text, or any prop the event does not list. Nothing is
// stored here and no cookie is set.
//
// Order: same-origin check -> rate limit (before the body is read) -> capped
// body -> name on the allow-list -> secrets set -> visitor IP present ->
// forward. Answers 204 when accepted or dropped after the name check.

import { errText } from "../lib/errors";
import { json, readBodyCapped } from "../lib/forms";
import { isRateLimited, webKey } from "../lib/ratelimit";
import { anonId } from "../lib/anon-id";

const PATH = "/api/e";

export const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/i/v0/e/";

// The 12 events the site may send, each with the only prop keys it may carry.
// Anything else is a 400; any other key is dropped. No key holds free text:
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

function isEventName(name: string): name is EventName {
  return Object.hasOwn(EVENT_PROPS, name);
}

// One event is well under 1 KiB. 2 KiB caps what one request makes us buffer.
export const EVENT_MAX_BYTES = 2 * 1024;
// A string prop must be a short slug: no spaces, "@", "." or capitals, so no
// email, URL, name or search text fits.
export const PROP_TOKEN = /^[a-z0-9_-]{1,40}$/;
// A slow PostHog never holds the visitor's request open past this.
const FORWARD_TIMEOUT_MS = 3000;

type PropValue = string | number | boolean;

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

// True when the request names our own origin. Browsers send Origin on every
// POST, sendBeacon included, so a missing one is not a page of ours.
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin !== null && origin === new URL(request.url).origin;
}

function parse(body: Uint8Array): { name: string; props: unknown } | null {
  try {
    const data = JSON.parse(new TextDecoder().decode(body)) as unknown;
    if (!data || typeof data !== "object") return null;
    const { name, props } = data as { name?: unknown; props?: unknown };
    return typeof name === "string" ? { name, props } : null;
  } catch {
    return null;
  }
}

export async function handle(request: Request, env: Env, _ctx?: ExecutionContext, now: Date = new Date()): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (await isRateLimited(env.EVENT_RATE_LIMIT, webKey(request, PATH))) return json({ error: "ratelimit" }, 429);

  const body = await readBodyCapped(request, EVENT_MAX_BYTES);
  const event = body ? parse(body) : null;
  if (!event || !isEventName(event.name)) return json({ error: "invalid" }, 400);
  const name = event.name;

  const missing = [
    ...(env.POSTHOG_PROJECT_TOKEN ? [] : ["POSTHOG_PROJECT_TOKEN"]),
    ...(env.ANON_ID_SALT ? [] : ["ANON_ID_SALT"]),
  ];
  if (!env.POSTHOG_PROJECT_TOKEN || !env.ANON_ID_SALT) {
    console.error(`${PATH}: secret not set: ${missing.join(", ")}; event dropped`);
    return json({ error: "unavailable" }, 503);
  }

  // Cloudflare sets this on every request it serves. Without it, every visitor
  // would hash to one id, so the event is dropped instead of merged.
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) {
    console.error(`${PATH}: no CF-Connecting-IP; event dropped`);
    return new Response(null, { status: 204 });
  }
  const distinctId = await anonId(env.ANON_ID_SALT, ip, request.headers.get("User-Agent") ?? "", now);
  const payload = {
    api_key: env.POSTHOG_PROJECT_TOKEN,
    event: name,
    distinct_id: distinctId,
    timestamp: now.toISOString(),
    properties: {
      ...cleanProps(name, event.props),
      $process_person_profile: false,
      $geoip_disable: true,
    },
  };

  try {
    // A fresh request: only Content-Type goes with it. No visitor header
    // (Cookie, User-Agent, Referer, CF-Connecting-IP, X-Forwarded-For) is copied.
    const res = await fetch(POSTHOG_CAPTURE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    if (!res.ok) console.error(`${PATH}: PostHog answered ${res.status}`);
  } catch (err) {
    // Best effort: a lost click must never surface as an error on the page.
    console.error(`${PATH}: forward failed:`, errText(err));
  }
  return new Response(null, { status: 204 });
}
