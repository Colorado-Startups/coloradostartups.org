// POST /api/nominate: Leaderboard nominations into D1 `nominations`. Owner: L2.
//
// Pipeline (worker/lib/forms.ts): formIntake (rate limit -> parse ->
// honeypot -> speed check) -> validate (NominationSchema plus the
// Leaderboard's own checks) -> turnstileError -> D1 insert -> notify (best
// effort) -> 303.
//
// Purpose limit: nomination data is used only to verify and rank, never for
// investment sourcing. Only Paul has access. Revenue figures and headcount are
// removed from the row 90 days after the edition they fed publishes
// (ops/runbooks/promote-submissions.md). The form and the privacy policy say so.
//
// The notification to Paul names the company and the row id only. Revenue
// never goes into an email, where the 90-day deletion cannot reach it.

import {
  NOMINATE_PATH,
  NOMINATE_RETURN_PATHS,
  NOMINATE_THANKS_PATH,
  parseNominationForm,
  pathWithInvalidFields,
} from "../../src/lib/leaderboard/nomination";
import { formIntake, makeSafeReturnTo, redirect, turnstileError } from "../lib/forms";
import { notify } from "../lib/notify";

const ROUTE_PATH = "/api/nominate";
const safeReturnTo = makeSafeReturnTo(NOMINATE_RETURN_PATHS, NOMINATE_PATH);

// Retention (privacy policy, Leaderboard nominations). A row no edition
// claimed loses its revenue, headcount and the nominator's name and email once
// it is NOMINATION_RETENTION_DAYS old. The weekly cron in worker/index.ts runs
// this, so no unclaimed row keeps them more than a week past the limit.
// ops/runbooks/promote-submissions.md, Nominations step 7, shows the same
// statement for a manual run; test/worker/l29g checks they match.
export const NOMINATION_RETENTION_DAYS = 180;
export const NOMINATION_SWEEP_SQL =
  "UPDATE nominations SET payload = json_remove(payload,'$.base_year_revenue_usd','$.current_year_revenue_usd','$.fte_headcount','$.contact_name','$.contact_email'), " +
  "financials_deleted_at = datetime('now') " +
  "WHERE edition_id IS NULL AND financials_deleted_at IS NULL " +
  `AND created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-${NOMINATION_RETENTION_DAYS} days')`;

/** Runs the retention sweep. Returns how many unclaimed nominations it cleared. */
export async function sweepNominations(db: D1Database): Promise<number> {
  const result = await db.prepare(NOMINATION_SWEEP_SQL).run();
  return result.meta.changes ?? 0;
}

// Takes one Leaderboard nomination form post. Answers 303: to the thanks page,
// or back to the form with ?error=<reason>.
export async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const intake = await formIntake(request, env, {
    path: ROUTE_PATH,
    formPath: NOMINATE_PATH,
    thanksPath: NOMINATE_THANKS_PATH,
    returnTo: (form) => safeReturnTo(form.get("return_to")),
  });
  if (intake instanceof Response) return intake;
  const { url, form, returnTo } = intake;

  const parsed = parseNominationForm(form);
  if (!parsed.ok) {
    console.log(`nominate: invalid fields ${parsed.fields.join(",")}`);
    // The form marks each named field; only NOMINATION_FIELDS names are sent.
    return redirect(url, pathWithInvalidFields(returnTo, parsed.fields), "invalid");
  }

  const botCheck = await turnstileError(form, request, env);
  if (botCheck) return redirect(url, returnTo, botCheck);

  const nomination = parsed.data;
  let id: number | undefined;
  try {
    const row = await env.DB.prepare(
      "INSERT INTO nominations (created_at, status, payload) VALUES (?, 'new', ?) RETURNING id",
    )
      .bind(new Date().toISOString(), JSON.stringify(nomination))
      .first<{ id: number }>();
    id = row?.id;
  } catch (err) {
    console.error("nominate: insert failed:", err instanceof Error ? err.message : err);
    return redirect(url, returnTo, "delivery");
  }

  ctx.waitUntil(
    notify(
      env.FORM_EMAIL,
      `Leaderboard nomination: ${nomination.legal_name}`,
      [
        "A new Leaderboard nomination is waiting in D1.",
        "",
        `Company: ${nomination.legal_name}`,
        `Website: ${nomination.website}`,
        `Sector: ${nomination.sector}`,
        `HQ: ${nomination.hq_city}, ${nomination.hq_county} County`,
        `Row: nominations.id = ${id ?? "unknown"}`,
        "",
        "Revenue figures stay in D1 only. Review steps: ops/runbooks/promote-submissions.md.",
      ].join("\n"),
    ),
  );

  return redirect(url, NOMINATE_THANKS_PATH);
}
