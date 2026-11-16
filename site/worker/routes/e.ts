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
// forward, after the reply (waitUntil). Answers 204 when accepted or dropped
// after the name check.

import { cleanProps, isEventName } from "@cs/shared";

import { anonId } from "../lib/anon-id";
import { errText } from "../lib/errors";
import { json, readBodyCapped } from "../lib/forms";
import { isRateLimited, webKey } from "../lib/ratelimit";

const PATH = "/api/e";

export const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/i/v0/e/";

// The 12 events and their prop keys live in @cs/shared (events.ts), the same
// list the page helper (src/lib/track.ts) sends from, so the site can never
// send a name this route refuses. Re-exported for the tests.
export { cleanProps, EVENT_NAMES, EVENT_PROPS, PROP_TOKEN, type EventName } from "@cs/shared";

// One event is well under 1 KiB. 2 KiB caps what one request makes us buffer.
export const EVENT_MAX_BYTES = 2 * 1024;
// A slow PostHog never holds an isolate past this.
const FORWARD_TIMEOUT_MS = 3000;

// A refused name logs one fixed line, with no payload, so a typo on the site
// leaves a trace. At most one line a minute per isolate: a client looping on
// a bad name, already slowed by the rate limit, cannot flood the logs.
export const REFUSED_LOG = `${PATH}: refused event name`;
export const REFUSED_LOG_EVERY_MS = 60_000;
let lastRefusedLog = Number.NEGATIVE_INFINITY;

function logRefused(now: Date): void {
  if (now.getTime() - lastRefusedLog < REFUSED_LOG_EVERY_MS) return;
  lastRefusedLog = now.getTime();
  console.error(REFUSED_LOG);
}

/** Test hook: forget the last refused-name line, so each test starts fresh. */
export function resetRefusedLog(): void {
  lastRefusedLog = Number.NEGATIVE_INFINITY;
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

// Sends one payload to PostHog. Never throws: a lost click must never surface
// as an error. The reply body is never read, so it is cancelled either way,
// which frees the connection at once.
async function forward(payload: unknown): Promise<void> {
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
    await res.body?.cancel().catch(() => {});
  } catch (err) {
    console.error(`${PATH}: forward failed:`, errText(err));
  }
}

export async function handle(request: Request, env: Env, ctx?: ExecutionContext, now: Date = new Date()): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (await isRateLimited(env.EVENT_RATE_LIMIT, webKey(request, PATH))) return json({ error: "ratelimit" }, 429);

  const body = await readBodyCapped(request, EVENT_MAX_BYTES);
  const event = body ? parse(body) : null;
  if (!event) return json({ error: "invalid" }, 400);
  if (!isEventName(event.name)) {
    logRefused(now);
    return json({ error: "invalid" }, 400);
  }
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

  // The reply does not wait for PostHog: waitUntil keeps the forward running
  // after the 204 goes out. Without a context (a direct call), it is awaited.
  const sent = forward(payload);
  if (ctx) ctx.waitUntil(sent);
  else await sent;
  return new Response(null, { status: 204 });
}
