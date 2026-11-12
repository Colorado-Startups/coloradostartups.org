// The site Worker. Small on purpose: static pages are served straight from
// assets (wrangler.jsonc sets run_worker_first to ["/api/*"]), so this file
// only routes /api/* to one handler per file, adds security headers, and runs
// the weekly retention jobs.
//
// It also exports ResourcusRPC, the named entrypoint the Communitas Worker
// binds to for Slack answers.

import { errText } from "./lib/errors";
import { json } from "./lib/forms";
import { applySecurityHeaders } from "./lib/security-headers";
import { purgeResourcusData } from "./resourcus/logs";
import { findRoute } from "./routes";
import { sweepApplications } from "./routes/apply";
import { purgeCspReports } from "./routes/csp-report";
import { sweepNominations } from "./routes/nominate";

export { ResourcusRPC } from "./rpc";

// Weekly retention (wrangler.jsonc triggers). Four jobs, each a deletion the
// privacy policy promises:
//   - ask_logs past 90 days and ask_sessions past one day (decision 38)
//   - seat applications still undecided after 180 days (L19)
//   - nominations no edition claimed, cleared at 180 days (L29g)
//   - security report types no browser has sent in 90 days (L29g)
// Each job returns its log line's counts, and nothing else.
const RETENTION: ReadonlyArray<readonly [label: string, job: (db: D1Database) => Promise<string>]> = [
  [
    "resourcus purge",
    async (db) => {
      const r = await purgeResourcusData(db);
      return `${r.logs} ask_logs, ${r.sessions} ask_sessions`;
    },
  ],
  ["applications sweep", async (db) => `${await sweepApplications(db)} declined and cleared`],
  ["nominations sweep", async (db) => `${await sweepNominations(db)} cleared`],
  ["csp_reports purge", async (db) => `${await purgeCspReports(db)} deleted`],
];

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const route = findRoute(url.pathname);
    if (!route) {
      if (url.pathname.startsWith("/api/")) {
        return withSecurityHeaders(json({ error: "invalid" }, 404));
      }
      return env.ASSETS.fetch(request);
    }
    if (!route.methods.includes(request.method)) {
      return withSecurityHeaders(
        new Response(null, { status: 405, headers: { Allow: route.methods.join(", ") } }),
      );
    }
    try {
      return withSecurityHeaders(await route.handle(request, env, ctx));
    } catch (err) {
      console.error(`${url.pathname} failed:`, errText(err));
      return withSecurityHeaders(json({ error: "unavailable" }, 503));
    }
  },

  // Runs every RETENTION job. Each logs a count only. Each has its own
  // waitUntil and its own rejection handler, so one failing never stops
  // another.
  async scheduled(_controller, env, ctx): Promise<void> {
    for (const [label, job] of RETENTION) {
      ctx.waitUntil(
        job(env.DB).then(
          (counts) => console.log(`${label}: ${counts}`),
          (err) => console.error(`${label} failed:`, errText(err)),
        ),
      );
    }
  },
} satisfies ExportedHandler<Env>;
