// Turnstile once per session, for the web door only.
//
// The panel makes a random session id (crypto.randomUUID) and keeps it in
// sessionStorage. The first question in a session carries a Turnstile token;
// once the token verifies, the session is marked in D1 `ask_sessions` and
// later questions skip the widget until SESSION_TTL_HOURS pass. The table
// stores a SHA-256 of the session id, never the id itself, so a leaked row
// cannot be replayed to skip Turnstile.
//
// Every failure here reads as "not verified", which sends the visitor back
// through Turnstile. That fails closed without locking anyone out.

import { errText } from "../lib/errors";

const SESSION_TTL_HOURS = 24;

const SESSION_ID = /^[A-Za-z0-9_-]{16,64}$/;

// Short or odd ids never count as a session: such a client passes Turnstile
// on every question instead.
export function isUsableSessionId(id: string | undefined): id is string {
  return typeof id === "string" && SESSION_ID.test(id);
}

// SHA-256 of a string, as lowercase hex.
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// True when this web session passed Turnstile within SESSION_TTL_HOURS. Fails
// closed: a bad id or a failed lookup means Turnstile again.
export async function isSessionVerified(db: D1Database | undefined, id: string, now = new Date()): Promise<boolean> {
  if (!db || !isUsableSessionId(id)) return false;
  try {
    const since = new Date(now.getTime() - SESSION_TTL_HOURS * 3_600_000).toISOString();
    const row = await db
      .prepare("SELECT 1 AS hit FROM ask_sessions WHERE session_hash = ? AND verified_at >= ?")
      .bind(await sha256Hex(id), since)
      .first<{ hit: number }>();
    return row !== null;
  } catch (err) {
    console.error("session lookup failed (requiring Turnstile):", errText(err));
    return false;
  }
}

// Records that this web session passed Turnstile, stored by hash, never the raw
// id. A failed write is logged; the visitor just sees Turnstile again.
export async function markSessionVerified(db: D1Database | undefined, id: string, now = new Date()): Promise<void> {
  if (!db || !isUsableSessionId(id)) return;
  try {
    await db
      .prepare(
        "INSERT INTO ask_sessions (session_hash, verified_at) VALUES (?1, ?2) ON CONFLICT(session_hash) DO UPDATE SET verified_at = ?2",
      )
      .bind(await sha256Hex(id), now.toISOString())
      .run();
  } catch (err) {
    console.error("session mark failed:", errText(err));
  }
}
