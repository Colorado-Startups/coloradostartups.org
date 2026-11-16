// POST /api/waitlist: the founders forum waitlist, into D1 `founders_waitlist`.
// Owner: L1, the /founders/ page's lane (step F1).
//
// Pipeline (worker/lib/forms.ts): formIntake (rate limit -> parse ->
// honeypot -> speed check) -> validate (WaitlistEntrySchema) ->
// turnstileError -> D1 insert, one row per email -> 303 to the thanks page.
//
// Four rules shape this route:
//   - One row per email. A second sign-up with an email already on the list
//     changes nothing (ON CONFLICT DO NOTHING), so nobody can overwrite
//     another person's entry by typing their address. Both answers are the
//     same thanks page, so the form never reveals who is on the list.
//   - No notice email. Paul has nothing to do per sign-up, so the entry stays
//     in D1 and no personal data leaves the database (F1 brief, 2026-11-16).
//   - No Worker ever fetches a URL a user supplied (BRIEF constraint 12). The
//     company website is parsed, then stored as text.
//   - Logs name failing fields, never their values.

import {
  parseWaitlistForm,
  WAITLIST_FORM_PATH,
  WAITLIST_THANKS_PATH,
  waitlistPathWithInvalidFields,
} from "../../src/components/founders/waitlist-fields";
import { formIntake, redirect, turnstileError } from "../lib/forms";

const ROUTE_PATH = "/api/waitlist";

// Retention (privacy policy, Joining the founders forum waitlist). An entry
// is deleted WAITLIST_RETENTION_DAYS after sign-up, whatever happened: if the
// forum has not opened by then, the person joins again (orchestrator, F1
// brief). The weekly cron in worker/index.ts runs this, so no entry outlives
// the limit by more than a week. The policy and the form's line state 365
// and 372 days, and "12 months"; test/unit/l29g/privacy-weekly.test.ts pins
// the policy's two figures to this constant.
export const WAITLIST_RETENTION_DAYS = 365;

/** Runs the retention purge. Returns how many entries it deleted. */
export async function purgeWaitlist(db: D1Database, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - WAITLIST_RETENTION_DAYS * 86_400_000).toISOString();
  const result = await db.prepare("DELETE FROM founders_waitlist WHERE created_at < ?").bind(cutoff).run();
  return result.meta.changes ?? 0;
}

// Takes one waitlist form post. Answers 303: to the thanks page, or back to
// the form with ?error=<reason>.
export async function handle(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const intake = await formIntake(request, env, {
    path: ROUTE_PATH,
    formPath: WAITLIST_FORM_PATH,
    thanksPath: WAITLIST_THANKS_PATH,
    returnTo: () => WAITLIST_FORM_PATH,
  });
  if (intake instanceof Response) return intake;
  const { url, form, returnTo } = intake;

  const parsed = parseWaitlistForm(form);
  if (!parsed.ok) {
    console.log(`waitlist: invalid fields ${parsed.fields.join(",")}`);
    // The form marks each named field; only WAITLIST_FIELDS names are sent.
    return redirect(url, waitlistPathWithInvalidFields(parsed.fields), "invalid");
  }

  const botCheck = await turnstileError(form, request, env);
  if (botCheck) return redirect(url, returnTo, botCheck);

  const r = parsed.data;
  try {
    await env.DB.prepare(
      `INSERT INTO founders_waitlist
         (created_at, first_name, last_name, email, company, company_website, stage, founder)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT (email) DO NOTHING`,
    )
      .bind(new Date().toISOString(), r.first_name, r.last_name, r.email, r.company, r.company_website, r.stage)
      .run();
  } catch (err) {
    console.error("waitlist: insert failed:", err instanceof Error ? err.message : err);
    return redirect(url, returnTo, "delivery");
  }

  return redirect(url, WAITLIST_THANKS_PATH);
}
