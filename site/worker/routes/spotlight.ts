// POST /api/spotlight: "Get featured" requests, into D1 `spotlight_requests`.
// Owner: the orchestrator, for the home page's founder spotlights (step P3a).
//
// Pipeline (worker/lib/forms.ts): formIntake (rate limit -> parse ->
// honeypot -> speed check) -> validate (SpotlightRequestSchema) ->
// turnstileError -> D1 insert -> notify (best effort) -> 303 to the thanks
// page.
//
// Four rules shape this route:
//   - No consent, no save. Both boxes are required by the schema, and the
//     table CHECKs them again. The row stores when they were ticked and the
//     version of their wording.
//   - Nothing is published. Paul reads each request and replies by hand; a
//     spotlight goes public only as a reviewed file in data/spotlights/ (P3b).
//   - No Worker ever fetches a URL a user supplied (BRIEF constraint 12). The
//     website and LinkedIn link are parsed, then stored as text.
//   - Logs name failing fields, never their values. The row is the record: a
//     failed insert is an error (?error=delivery), a failed notice email is
//     not. notify() logs it, and the visitor still reaches the thanks page.

import {
  parseSpotlightForm,
  SPOTLIGHT_CONSENT_VERSION,
  SPOTLIGHT_PATH,
  SPOTLIGHT_THANKS_PATH,
  spotlightNoticeBody,
  spotlightNoticeSubject,
  spotlightPathWithInvalidFields,
} from "../../src/components/spotlight/fields";
import { formIntake, redirect, turnstileError } from "../lib/forms";
import { notify } from "../lib/notify";

const ROUTE_PATH = "/api/spotlight";

// Retention (privacy policy, Asking to be featured). A request is deleted
// SPOTLIGHT_RETENTION_DAYS after it arrives, whatever its status: Paul acts
// from the notice email, and a published spotlight lives on only as its card
// in the repo's data, with its own removal path (orchestrator, P3a brief).
// The weekly cron in worker/index.ts runs this, so no request outlives the
// limit by more than a week. test/unit/l29g/privacy-weekly.test.ts pins the
// policy's 180 and 187 days to this constant.
export const SPOTLIGHT_RETENTION_DAYS = 180;

/** Runs the retention purge. Returns how many requests it deleted. */
export async function purgeSpotlightRequests(db: D1Database, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SPOTLIGHT_RETENTION_DAYS * 86_400_000).toISOString();
  const result = await db.prepare("DELETE FROM spotlight_requests WHERE created_at < ?").bind(cutoff).run();
  return result.meta.changes ?? 0;
}

// Takes one "Get featured" form post. Answers 303: to the thanks page, or
// back to the form with ?error=<reason>.
export async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const intake = await formIntake(request, env, {
    path: ROUTE_PATH,
    formPath: SPOTLIGHT_PATH,
    thanksPath: SPOTLIGHT_THANKS_PATH,
    returnTo: () => SPOTLIGHT_PATH,
  });
  if (intake instanceof Response) return intake;
  const { url, form, returnTo } = intake;

  const parsed = parseSpotlightForm(form);
  if (!parsed.ok) {
    console.log(`spotlight: invalid fields ${parsed.fields.join(",")}`);
    // The form marks each named field; only SPOTLIGHT_FIELDS names are sent.
    return redirect(url, spotlightPathWithInvalidFields(parsed.fields), "invalid");
  }

  const botCheck = await turnstileError(form, request, env);
  if (botCheck) return redirect(url, returnTo, botCheck);

  const r = parsed.data;
  const now = new Date().toISOString();
  let id: number | null = null;
  try {
    const row = await env.DB.prepare(
      `INSERT INTO spotlight_requests
         (created_at, status, first_name, last_name, email, role, company, company_website, city, building,
          linkedin, founder, consent_show, consent_at, consent_version)
       VALUES (?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
      .bind(
        now,
        r.first_name,
        r.last_name,
        r.email,
        r.role,
        r.company,
        r.company_website,
        r.city,
        r.building,
        r.linkedin,
        // The schema already refused a missing box; the table CHECKs it again.
        r.founder ? 1 : 0,
        r.consent_show ? 1 : 0,
        now,
        SPOTLIGHT_CONSENT_VERSION,
      )
      .first<{ id: number }>();
    id = row?.id ?? null;
  } catch (err) {
    console.error("spotlight: insert failed:", err instanceof Error ? err.message : err);
    return redirect(url, returnTo, "delivery");
  }

  // Best effort: notify() never throws and logs a failed send.
  ctx.waitUntil(notify(env.FORM_EMAIL, spotlightNoticeSubject(r), spotlightNoticeBody(r, id, now)));

  return redirect(url, SPOTLIGHT_THANKS_PATH);
}
