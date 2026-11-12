// POST /api/csp-report: the CSP violation sink. Browsers send these
// automatically, many per page, so the limiter drops excess from one IP before
// a byte of the body is read. The body is read under a byte cap, and anything
// over it is dropped. Always answers 204.

import { parseCspReport, type CspViolation } from "../lib/csp";
import { errText } from "../lib/errors";
import { readBodyCapped } from "../lib/forms";
import { isRateLimited, webKey } from "../lib/ratelimit";

const PATH = "/api/csp-report";

// A browser's report is a few hundred bytes. 8 KiB leaves room for a long
// blocked URL and script sample, and caps what one request can make us buffer.
const CSP_REPORT_MAX_BYTES = 8 * 1024;

// Retention (privacy policy, Security reports). A report type that no browser
// has sent in CSP_REPORT_RETENTION_DAYS is deleted. The weekly cron in
// worker/index.ts runs this. ops/runbooks/promote-submissions.md, Weekly job,
// shows the same statement for a manual run; test/worker/l29g checks they match.
export const CSP_REPORT_RETENTION_DAYS = 90;
export const CSP_REPORT_PURGE_SQL =
  `DELETE FROM csp_reports WHERE last_seen < strftime('%Y-%m-%dT%H:%M:%SZ','now','-${CSP_REPORT_RETENTION_DAYS} days')`;

/** Runs the retention purge. Returns how many report types it deleted. */
export async function purgeCspReports(db: D1Database): Promise<number> {
  const result = await db.prepare(CSP_REPORT_PURGE_SQL).run();
  return result.meta.changes ?? 0;
}

// Stores one browser violation report when it parses. Always answers 204.
export async function handle(request: Request, env: Env): Promise<Response> {
  try {
    if (await isRateLimited(env.FORM_RATE_LIMIT, webKey(request, PATH))) return new Response(null, { status: 204 });
    const body = await readBodyCapped(request, CSP_REPORT_MAX_BYTES);
    if (body && body.byteLength > 0) {
      const violation = parseCspReport(JSON.parse(new TextDecoder().decode(body)));
      if (violation) await record(env, violation);
    }
  } catch (err) {
    console.error("csp-report not stored:", errText(err));
  }
  return new Response(null, { status: 204 });
}

async function record(env: Env, v: CspViolation): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO csp_reports
       (signature, directive, blocked_uri, document_uri, count, first_seen, last_seen)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(signature) DO UPDATE SET count = count + 1, last_seen = excluded.last_seen`,
  )
    .bind(v.signature, v.directive, v.blockedUri, v.documentUri, now, now)
    .run();
}
