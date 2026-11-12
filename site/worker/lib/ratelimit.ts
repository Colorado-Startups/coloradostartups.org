// Per-key throttle on the Workers rate-limit binding. Fails OPEN: a limiter
// error must never block a real visitor, because Turnstile (web) and Slack
// request signatures (Slack) are the authoritative gates, and the budget guard
// is the spending stop. Enforced on Cloudflare's network and in the test pool,
// not in `wrangler dev`.

import { errText } from "./errors";

export interface Limiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

// True when the limiter says this key is over its limit. Fails open: with no
// binding, or when the check throws, the request goes through.
export async function isRateLimited(limiter: Limiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return false;
  try {
    const { success } = await limiter.limit({ key });
    return !success;
  } catch (err) {
    console.error("rate-limit check failed (allowing):", errText(err));
    return false;
  }
}

// The key for a web request: visitor IP plus route path, so each endpoint has
// its own budget. The IP is used only as a limiter key and is never stored.
export function webKey(request: Request, path: string): string {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  return `${ip}:${path}`;
}
