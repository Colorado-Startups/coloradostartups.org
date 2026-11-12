// Server-side Turnstile check. Tokens are single-use and expire after 300 s
// (Cloudflare docs, server-side validation). Any network or parse failure
// counts as "not verified": Turnstile is the authoritative bot gate, so it
// fails closed, unlike the rate limiter.

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Asks Cloudflare's siteverify whether a Turnstile token is valid. False on a
// missing token or secret, a network error or any answer but success.
export async function verifyTurnstile(
  token: string,
  secret: string | undefined,
  ip: string | null,
): Promise<boolean> {
  if (!token || !secret) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  try {
    const res = await fetch(SITEVERIFY, { method: "POST", body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
