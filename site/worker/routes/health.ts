// GET /api/health: a URL an uptime monitor can poll. Owner: L4.
//
// 200 means the Worker script runs and D1 answers a read. 503 means D1 did not
// answer within DB_TIMEOUT_MS. It reads no table, writes nothing, and names no
// secret, binding value or version, so it is safe to leave public. HEAD gets
// the same status with no body. No rate limit, on purpose: a monitor polls it,
// and a call costs one SELECT 1 that reads no table.

import { errText } from "../lib/errors";
import { json } from "../lib/forms";

// Goal: answer in under 1.5 s (the live sweep's slow threshold). A stuck D1
// read gives up after 1 s, so even the failure answer lands inside it.
export const DB_TIMEOUT_MS = 1000;

/** Answers a health probe: 200 when D1 answers `SELECT 1`, else 503. */
export async function handle(request: Request, env: Env): Promise<Response> {
  const db = await pingDb(env.DB);
  const status = db === "ok" ? 200 : 503;
  const res = json({ status: db === "ok" ? "ok" : "degraded", db }, status);
  return request.method === "HEAD" ? new Response(null, { status, headers: res.headers }) : res;
}

async function pingDb(db: D1Database): Promise<"ok" | "down"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${DB_TIMEOUT_MS} ms`)), DB_TIMEOUT_MS);
  });
  try {
    await Promise.race([db.prepare("SELECT 1").first(), timeout]);
    return "ok";
  } catch (err) {
    console.error("health: D1 check failed:", errText(err));
    return "down";
  } finally {
    clearTimeout(timer);
  }
}
