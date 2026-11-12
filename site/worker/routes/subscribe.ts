// POST /api/subscribe: newsletter sign-up into Kit with double opt-in. Owner: L6.
//
// Pipeline (worker/lib/forms.ts order): formIntake (rate limit, form content
// type, parse, honeypot, speed check), Kit and Turnstile configured?,
// validate, turnstileError, Kit, 303 to /newsletter/thanks/.
// The site never stores the address. Kit holds the list.
//
// Double opt-in takes two Kit v4 calls (developers.kit.com, read 2026-10-08):
//   1. POST /v4/subscribers with state "inactive" (an upsert; state is
//      create-only, so an existing subscriber keeps theirs);
//   2. POST /v4/forms/{id}/subscribers, which sends the form's confirmation
//      email when the form has double opt-in on. ops/email/runbook.md has
//      Paul confirm that end to end before launch.
//
// A new address and an address already on the list get the same answer, so
// the form never reveals who is subscribed.

import { FIELD_LIMITS, SITE_ORIGIN } from "../lib/config";
import { formIntake, json, makeSafeReturnTo, redirect, turnstileError } from "../lib/forms";
import { isPlausibleEmail, singleLine } from "../lib/validate";

const PATH = "/api/subscribe";
const THANKS = "/newsletter/thanks/";
const KIT_API = "https://api.kit.com/v4";
const KIT_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 8192;
const FORM_TYPES = /^(application\/x-www-form-urlencoded|multipart\/form-data)\b/i;

// Every page L1 places <NewsletterSignup> on. Errors return here.
export const RETURN_PATHS = ["/", "/newsletter/", "/community/"] as const;
const FALLBACK = "/newsletter/";
const safeReturnTo = makeSafeReturnTo(RETURN_PATHS, FALLBACK);

// Takes one newsletter sign-up form post. Answers 303: to the thanks page, or
// back to the page it came from with ?error=<reason>. A body that is not a
// form gets 415.
export async function handle(request: Request, env: Env): Promise<Response> {
  const intake = await formIntake(request, env, {
    path: PATH,
    formPath: FALLBACK,
    thanksPath: THANKS,
    returnTo: (form) => safeReturnTo(form.get("return_to")),
    maxBytes: MAX_BODY_BYTES,
    // The sign-up form always posts form data. Anything else is a script, not
    // a visitor, so it gets a plain 415 instead of a redirect to a page.
    beforeBody: (req) =>
      FORM_TYPES.test(req.headers.get("Content-Type") ?? "") ? null : json({ error: "invalid" }, 415),
  });
  if (intake instanceof Response) return intake;
  const { url, form, returnTo } = intake;

  // Without Kit there is no list, and without the Turnstile secret there is no
  // bot check. Both are configuration faults on our side, hence "unavailable".
  // This route checks them before validation; the other forms validate first.
  if (!env.KIT_API_KEY || !env.KIT_FORM_ID || !env.TURNSTILE_SECRET_KEY) {
    return redirect(url, returnTo, "unavailable");
  }

  const email = singleLine(String(form.get("email") ?? "")).toLowerCase();
  if (email.length > FIELD_LIMITS.email || !isPlausibleEmail(email)) {
    return redirect(url, returnTo, "invalid");
  }

  const botCheck = await turnstileError(form, request, env);
  if (botCheck) return redirect(url, returnTo, botCheck);

  const outcome = await subscribeToKit(env.KIT_API_KEY, env.KIT_FORM_ID, email, `${SITE_ORIGIN}${returnTo}`);
  return outcome === "ok" ? redirect(url, THANKS) : redirect(url, returnTo, outcome);
}

export type KitOutcome = "ok" | "invalid" | "unavailable" | "delivery";

// Maps a Kit status to what the visitor sees. 422 means Kit rejected the
// address. 401, 403 and 404 are setup problems (key or form id), which a retry
// cannot fix. Everything else, 429 and 5xx included, is worth a retry later.
export function kitStatusOutcome(status: number): KitOutcome {
  if (status >= 200 && status < 300) return "ok";
  if (status === 422) return "invalid";
  if (status === 401 || status === 403 || status === 404) return "unavailable";
  return "delivery";
}

async function kitPost(apiKey: string, path: string, body: Record<string, string>): Promise<KitOutcome> {
  try {
    const res = await fetch(`${KIT_API}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Kit-Api-Key": apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(KIT_TIMEOUT_MS),
    });
    const outcome = kitStatusOutcome(res.status);
    // Status only: Kit's error text can echo the address.
    if (outcome !== "ok") console.error(`kit ${path.split("/")[1]} failed: HTTP ${res.status}`);
    return outcome;
  } catch (err) {
    console.error("kit unreachable:", err instanceof Error ? err.name : "error");
    return "delivery";
  }
}

async function subscribeToKit(
  apiKey: string,
  formId: string,
  email: string,
  referrer: string,
): Promise<KitOutcome> {
  // first_name is left out on purpose: the upsert would overwrite the name an
  // existing subscriber already has.
  const created = await kitPost(apiKey, "/subscribers", { email_address: email, state: "inactive" });
  if (created !== "ok") return created;
  return kitPost(apiKey, `/forms/${encodeURIComponent(formId)}/subscribers`, {
    email_address: email,
    referrer,
  });
}
