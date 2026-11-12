import { http, HttpResponse } from "msw";

// L2's MSW handler factories. Tests register them with server.use(...).
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const turnstilePasses = () => http.post(SITEVERIFY, () => HttpResponse.json({ success: true }));
export const turnstileFails = () =>
  http.post(SITEVERIFY, () => HttpResponse.json({ success: false, "error-codes": ["invalid-input-response"] }));
