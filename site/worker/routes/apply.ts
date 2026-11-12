// POST /api/apply: seat applications into D1 `applications`. Owner: L19.
//
// Pipeline (worker/lib/forms.ts): formIntake (rate limit -> parse ->
// honeypot -> speed check) -> validate (ApplicationSchema) -> turnstileError
// -> D1 insert -> notify (best effort) -> 303 to the thanks page.
//
// Three rules shape this route:
//   - No Worker ever fetches a URL a user supplied (BRIEF constraint 12). The
//     LinkedIn and badge links are parsed, then stored as text. Paul opens
//     them himself during review.
//   - Contact data stays in D1. Logs name failing fields, never their values,
//     and the notice to Paul carries the seat and the row id only.
//   - A failed insert is an error (?error=delivery), not a quiet success,
//     because the row is the only record of the application.

import {
  APPLY_PATH,
  APPLY_THANKS_PATH,
  applyPathFor,
  noticeBody,
  noticeSubject,
  parseApplicationForm,
} from "../../src/components/apply/fields";
import { formIntake, redirect, turnstileError } from "../lib/forms";
import { notify } from "../lib/notify";

const ROUTE_PATH = "/api/apply";

// Retention (privacy policy, Applications). An application still undecided
// after APPLICATION_RETENTION_DAYS is declined and its applicant fields are
// cleared. The weekly cron in worker/index.ts runs this, so no undecided row
// outlives the limit by more than a week. ops/runbooks/promote-submissions.md
// shows the same statement for a manual run; test/worker/l19 checks they match.
const APPLICATION_RETENTION_DAYS = 180;
const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')";
export const APPLICATION_SWEEP_SQL =
  `UPDATE applications SET status = 'declined', decided_at = ${NOW}, ` +
  "name = NULL, email = NULL, based_in = NULL, linkedin = NULL, why = NULL, badges = NULL, anything_else = NULL, " +
  `contact_deleted_at = ${NOW} ` +
  "WHERE status IN ('new', 'reviewing') AND contact_deleted_at IS NULL " +
  `AND created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-${APPLICATION_RETENTION_DAYS} days')`;

/** Runs the retention sweep. Returns how many applications it declined and cleared. */
export async function sweepApplications(db: D1Database): Promise<number> {
  const result = await db.prepare(APPLICATION_SWEEP_SQL).run();
  return result.meta.changes ?? 0;
}

// Takes one seat application form post. Answers 303: to the thanks page, or
// back to the form with ?error=<reason>.
export async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const intake = await formIntake(request, env, {
    path: ROUTE_PATH,
    formPath: APPLY_PATH,
    thanksPath: APPLY_THANKS_PATH,
    // Back to the form with the same seat selected. Only a known seat id is
    // reflected into the Location header.
    returnTo: (form) => applyPathFor(form.get("role")),
  });
  if (intake instanceof Response) return intake;
  const { url, form, returnTo: back } = intake;

  const parsed = parseApplicationForm(form);
  if (!parsed.ok) {
    console.log(`apply: invalid fields ${parsed.fields.join(",")}`);
    return redirect(url, back, "invalid");
  }

  const botCheck = await turnstileError(form, request, env);
  if (botCheck) return redirect(url, back, botCheck);

  const a = parsed.data;
  const now = new Date().toISOString();
  let id: number | null = null;
  try {
    const row = await env.DB.prepare(
      `INSERT INTO applications
         (created_at, status, role, name, email, based_in, linkedin, why, badges, anything_else, consent_at)
       VALUES (?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
      .bind(now, a.role, a.name, a.email, a.based_in, a.linkedin, a.why, JSON.stringify(a.badges), a.anything_else, now)
      .first<{ id: number }>();
    id = row?.id ?? null;
  } catch (err) {
    console.error("apply: insert failed:", err instanceof Error ? err.message : err);
    return redirect(url, back, "delivery");
  }

  ctx.waitUntil(notify(env.FORM_EMAIL, noticeSubject(a.role), noticeBody(a.role, id)));

  return redirect(url, APPLY_THANKS_PATH);
}
