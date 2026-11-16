// POST /api/e: one anonymous click event from our own pages, forwarded to
// PostHog. Owner: M1a (engagement plan).
//
// What reaches PostHog: the event name (one of EVENT_NAMES), a few flat props,
// a distinct_id that changes every UTC day (lib/anon-id.ts), and two flags:
// $process_person_profile false (no person profile) and $geoip_disable true
// (no location). What never does: the visitor IP, cookies, the User-Agent,
// the Referer, or any prop the page names with a leading "$". Nothing is
// stored here and no cookie is set.
//
// Order: same-origin check -> rate limit (before the body is read) -> capped
// body -> name on the allow-list -> forward. Answers 204 when accepted.

import { errText } from "../lib/errors";
import { json, readBodyCapped } from "../lib/forms";
import { isRateLimited, webKey } from "../lib/ratelimit";
import { anonId } from "../lib/anon-id";

const PATH = "/api/e";

export const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/i/v0/e/";

// The 12 events the site may send. Anything else is a 400.
export const EVENT_NAMES = [
  "join_click",
  "join_submit",
  "newsletter_submit",
  "ask_used",
  "search_used",
  "connect_copy",
  "connect_click",
  "door_pick",
  "map_region_open",
  "resource_out",
  "event_out",
  "step_done",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];
const ALLOWED = new Set<string>(EVENT_NAMES);

// One event is well under 1 KiB. 2 KiB caps what one request makes us buffer.
export const EVENT_MAX_BYTES = 2 * 1024;
// Props stay small and flat: at most 8 keys, short keys, short string values.
export const PROPS_MAX_KEYS = 8;
const PROP_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const PROP_VALUE_MAX = 200;
// A slow PostHog never holds the visitor's request open past this.
const FORWARD_TIMEOUT_MS = 3000;

type PropValue = string | number | boolean;

// Keeps only flat props with safe keys. A key that starts with "$" (PostHog's
// reserved space, $ip among them) fails PROP_KEY and is dropped.
export function cleanProps(raw: unknown): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= PROPS_MAX_KEYS) break;
    if (!PROP_KEY.test(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, PROP_VALUE_MAX);
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
  if (!event || !ALLOWED.has(event.name)) return json({ error: "invalid" }, 400);

  if (!env.POSTHOG_PROJECT_TOKEN || !env.ANON_ID_SALT) return json({ error: "unavailable" }, 503);

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const distinctId = await anonId(env.ANON_ID_SALT, ip, request.headers.get("User-Agent") ?? "", now);
  const payload = {
    api_key: env.POSTHOG_PROJECT_TOKEN,
    event: event.name,
    distinct_id: distinctId,
    timestamp: now.toISOString(),
    properties: {
      ...cleanProps(event.props),
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
