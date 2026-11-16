// The anonymous visitor id for /api/e. A salted SHA-256 of the UTC date, the
// visitor IP and the User-Agent. Nothing is stored and no cookie is set: the
// same browser gets the same id for one UTC day, then a new one, so no event
// links to the visitor across days. The IP enters the hash and goes nowhere
// else. The salt is the ANON_ID_SALT secret, so nobody without it can rebuild
// an id from a known IP.

// The UTC day, as YYYY-MM-DD. The id changes when this does.
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The anonymous id for one visitor on one UTC day: 32 hex characters. */
export async function anonId(salt: string, ip: string, userAgent: string, now: Date = new Date()): Promise<string> {
  const input = new TextEncoder().encode(`${salt}\n${utcDay(now)}\n${ip}\n${userAgent}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return Array.from(digest.subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
