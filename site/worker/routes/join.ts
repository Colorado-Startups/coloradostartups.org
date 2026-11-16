// POST /api/join: requests to join the Colorado Startups Slack, into D1
// `slack_join_requests`. Owner: L6 Comms (step P5a).
//
// Pipeline (worker/lib/forms.ts): formIntake (rate limit -> parse ->
// honeypot -> speed check) -> validate (JoinRequestSchema) -> turnstileError
// -> D1 insert -> notify (best effort) -> 303 to the thanks page.
//
// Three rules shape this route:
//   - No Worker ever fetches a URL a user supplied (BRIEF constraint 12). The
//     LinkedIn link is parsed, then stored as text. Paul opens it himself.
//   - Logs name failing fields, never their values.
//   - The row is the record. A failed insert is an error (?error=delivery).
//     A failed notice email is not: notify() logs it, and the visitor still
//     reaches the thanks page, because Paul can read the request in D1.

import {
  JOIN_PATH,
  JOIN_THANKS_PATH,
  joinNoticeBody,
  joinNoticeSubject,
  joinPathWithInvalidFields,
  parseJoinForm,
} from "../../src/components/join/fields";
import { formIntake, redirect, turnstileError } from "../lib/forms";
import { notify } from "../lib/notify";

const ROUTE_PATH = "/api/join";

// Retention (privacy policy, Asking to join our Slack on this site). A request
// is deleted JOIN_REQUEST_RETENTION_DAYS after it arrives, whatever its
// status: Paul acts from the notice email, and the row is the backup record
// (orchestrator, PR #92 review). The weekly cron in worker/index.ts runs
// this, so no request outlives the limit by more than a week.
export const JOIN_REQUEST_RETENTION_DAYS = 90;

/** Runs the retention purge. Returns how many requests it deleted. */
export async function purgeJoinRequests(db: D1Database, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - JOIN_REQUEST_RETENTION_DAYS * 86_400_000).toISOString();
  const result = await db.prepare("DELETE FROM slack_join_requests WHERE created_at < ?").bind(cutoff).run();
  return result.meta.changes ?? 0;
}

// Takes one Slack join request form post. Answers 303: to the thanks page, or
// back to the form with ?error=<reason>.
export async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const intake = await formIntake(request, env, {
    path: ROUTE_PATH,
    formPath: JOIN_PATH,
    thanksPath: JOIN_THANKS_PATH,
    returnTo: () => JOIN_PATH,
  });
  if (intake instanceof Response) return intake;
  const { url, form, returnTo } = intake;

  const parsed = parseJoinForm(form);
  if (!parsed.ok) {
    console.log(`join: invalid fields ${parsed.fields.join(",")}`);
    // The form marks each named field; only JOIN_FIELDS names are sent.
    return redirect(url, joinPathWithInvalidFields(parsed.fields), "invalid");
  }

  const botCheck = await turnstileError(form, request, env);
  if (botCheck) return redirect(url, returnTo, botCheck);

  const r = parsed.data;
  let id: number | null = null;
  try {
    const row = await env.DB.prepare(
      `INSERT INTO slack_join_requests
         (created_at, status, first_name, last_name, email, linkedin, based, city, describes, heard, newsletter)
       VALUES (?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
      .bind(
        new Date().toISOString(),
        r.first_name,
        r.last_name,
        r.email,
        r.linkedin,
        r.based,
        r.city,
        r.describes,
        r.heard,
        r.newsletter ? 1 : 0,
      )
      .first<{ id: number }>();
    id = row?.id ?? null;
  } catch (err) {
    console.error("join: insert failed:", err instanceof Error ? err.message : err);
    return redirect(url, returnTo, "delivery");
  }

  // Best effort: notify() never throws and logs a failed send.
  ctx.waitUntil(notify(env.FORM_EMAIL, joinNoticeSubject(r), joinNoticeBody(r, id)));

  return redirect(url, JOIN_THANKS_PATH);
}
