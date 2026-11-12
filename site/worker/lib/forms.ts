// Shared steps of every HTML form handler. The rate limit runs BEFORE the body
// is read, and a missing `ts` stamp fails the speed check.
//
// Pipeline for a form route:
//   formIntake():     rateLimited? -> beforeBody? -> parse -> return path ->
//                     honeypot -> tooFast?
//   the route:        validate
//   turnstileError(): secret set? -> Turnstile
//   the route:        store in D1 (a failed insert is ?error=delivery) ->
//                     notify (best effort) -> 303 redirect

import { MAX_FORM_BYTES, MIN_SUBMIT_MS } from "./config";
import { isRateLimited, webKey } from "./ratelimit";
import { verifyTurnstile } from "./turnstile";

export type FormError = "invalid" | "verification" | "ratelimit" | "delivery" | "unavailable";

// 303 so the browser follows with a GET. `error` is a fixed enum, so nothing
// visitor-controlled is ever reflected into the Location header.
export function redirect(requestUrl: URL, path: string, error?: FormError): Response {
  const target = new URL(path, requestUrl.origin);
  if (error) target.searchParams.set("error", error);
  return new Response(null, { status: 303, headers: { Location: target.toString() } });
}

// return_to is attacker-controlled. Only paths in the route's own allowlist are
// reflected; anything else falls back to the given default.
export function makeSafeReturnTo(allowed: readonly string[], fallback: string) {
  const set = new Set(allowed);
  return (value: FormDataEntryValue | null): string => {
    const v = typeof value === "string" ? value : "";
    return set.has(v) ? v : fallback;
  };
}

// Reads a request body, counting bytes as they arrive and stopping at the cap.
// Returns null for an oversized body, whether Content-Length declares it or a
// chunked body (which has none) runs past the cap; the rest is cancelled, not
// read. Also null when the upload breaks off mid-read: that is an invalid
// request, so the caller answers it, not the Worker's 503. No route reads a
// body through request.text(), .json() or .formData() directly, so none can
// skip the cap.
export async function readBodyCapped(request: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get("Content-Length") ?? NaN);
  if (Number.isFinite(declared) && declared > max) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    } catch {
      return null;
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return bytes;
}

// Reads a form body through readBodyCapped. Returns null for an oversized or
// unparseable body; callers answer with their "invalid" redirect. Every form
// route parses through this (decision 35).
export async function readFormCapped(request: Request, max: number = MAX_FORM_BYTES): Promise<FormData | null> {
  const bytes = await readBodyCapped(request, max);
  if (!bytes) return null;
  try {
    return await new Response(bytes, {
      headers: { "Content-Type": request.headers.get("Content-Type") ?? "" },
    }).formData();
  } catch {
    return null;
  }
}

// Hidden field named "website". Humans never see it; bots fill it. The caller
// returns a quiet success so the bot learns nothing.
export function honeypotTripped(form: FormData): boolean {
  return String(form.get("website") ?? "").length > 0;
}

// The page stamps `ts` (ms since epoch) when it loads. Missing, malformed, in
// the future, or under MIN_SUBMIT_MS old all fail.
export function submittedTooFast(form: FormData, now: number = Date.now()): boolean {
  const ts = Number(form.get("ts") ?? NaN);
  if (!Number.isFinite(ts) || ts <= 0 || ts > now) return true;
  return now - ts < MIN_SUBMIT_MS;
}

export interface FormIntakeOptions {
  /** The route's own path. It keys the per-IP rate limit. */
  path: string;
  /** The form page. A rate-limited post or an unreadable body goes back here. */
  formPath: string;
  /** The thanks page. A honeypot hit lands here, the answer a person gets. */
  thanksPath: string;
  /** Picks the allowlisted path that later errors go back to. */
  returnTo: (form: FormData) => string;
  /** The body cap in bytes. Defaults to MAX_FORM_BYTES. */
  maxBytes?: number;
  /** Runs after the rate limit and before the body is read. A Response ends the request. */
  beforeBody?: (request: Request) => Response | null;
}

export interface FormIntake {
  url: URL;
  form: FormData;
  returnTo: string;
}

// The steps every form route runs before its own validation. Returns the
// Response that ends the request, or the parsed form. The rate limit runs
// before anything reads the body (#351), so a limited visitor costs no read.
export async function formIntake(
  request: Request,
  env: Pick<Env, "FORM_RATE_LIMIT">,
  opts: FormIntakeOptions,
): Promise<FormIntake | Response> {
  const url = new URL(request.url);
  if (await isRateLimited(env.FORM_RATE_LIMIT, webKey(request, opts.path))) {
    return redirect(url, opts.formPath, "ratelimit");
  }
  const early = opts.beforeBody?.(request);
  if (early) return early;

  // Decision 35: every form route reads its body through the byte cap.
  const form = await readFormCapped(request, opts.maxBytes);
  if (!form) return redirect(url, opts.formPath, "invalid");
  const returnTo = opts.returnTo(form);

  // A bot filled the hidden field. It gets the page a person gets, so it
  // learns nothing, and nothing is stored.
  if (honeypotTripped(form)) return redirect(url, opts.thanksPath);
  if (submittedTooFast(form)) return redirect(url, returnTo, "verification");
  return { url, form, returnTo };
}

// The bot check a route runs after its own validation. Returns null for a
// person, or the error to send back. Without the secret nothing can be
// verified, so nothing is accepted. That is a configuration fault on our side,
// hence "unavailable". A token that is not a string (a file part) counts as
// missing and never reaches siteverify.
export async function turnstileError(
  form: FormData,
  request: Request,
  env: Pick<Env, "TURNSTILE_SECRET_KEY">,
): Promise<FormError | null> {
  if (!env.TURNSTILE_SECRET_KEY) return "unavailable";
  const token = form.get("cf-turnstile-response");
  const human = await verifyTurnstile(
    typeof token === "string" ? token : "",
    env.TURNSTILE_SECRET_KEY,
    request.headers.get("CF-Connecting-IP"),
  );
  return human ? null : "verification";
}

// A JSON response marked no-store, so no cache keeps a per-request answer.
// `extra` adds headers, such as Retry-After on a 429.
export function json(body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}
