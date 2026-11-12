// MSW handlers for Turnstile's siteverify endpoint, owned by L3. Register with
// server.use(...) in a test; the shared server lives in test/worker/server.ts.
import { http, HttpResponse } from "msw";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Passes exactly one token and records what the Worker sent, so a test can
// check the secret and the visitor IP without trusting the Worker's word.
export function turnstileAccepting(goodToken: string, seen: FormData[] = []) {
  return http.post(SITEVERIFY, async ({ request }) => {
    const body = await request.formData();
    seen.push(body);
    return HttpResponse.json({ success: body.get("response") === goodToken });
  });
}

export function turnstileDown() {
  return http.post(SITEVERIFY, () => HttpResponse.error());
}
