// The route table. Orchestrator-owned: a lane that needs a new /api/ path asks
// for it. Each route lives in its own file and exports `handle`; the owning
// lane is named beside it.

import * as apply from "./apply"; // L19 Seat applications
import * as ask from "./ask"; // L4 Resourcus
import * as cspReport from "./csp-report"; // orchestrator
import * as e from "./e"; // M1a anonymous events
import * as health from "./health"; // L4 Worker
import * as join from "./join"; // L6 Comms, Slack join requests (P5a)
import * as nominate from "./nominate"; // L2 Leaderboard
import * as spotlight from "./spotlight"; // orchestrator, "Get featured" for home spotlights (P3a)
import * as subscribe from "./subscribe"; // L6 Comms
import * as suggestResource from "./suggest-resource"; // L3 Canvas
import * as waitlist from "./waitlist"; // L1, the founders forum waitlist (F1)

type RouteHandler = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

interface Route {
  methods: readonly string[];
  handle: RouteHandler;
}

export const ROUTES: Readonly<Record<string, Route>> = {
  "/api/ask": { methods: ["POST"], handle: ask.handle },
  "/api/subscribe": { methods: ["POST"], handle: subscribe.handle },
  "/api/nominate": { methods: ["POST"], handle: nominate.handle },
  "/api/suggest-resource": { methods: ["POST"], handle: suggestResource.handle },
  "/api/apply": { methods: ["POST"], handle: apply.handle },
  "/api/join": { methods: ["POST"], handle: join.handle },
  "/api/waitlist": { methods: ["POST"], handle: waitlist.handle },
  "/api/spotlight": { methods: ["POST"], handle: spotlight.handle },
  "/api/csp-report": { methods: ["POST"], handle: cspReport.handle },
  "/api/e": { methods: ["POST"], handle: e.handle },
  "/api/health": { methods: ["GET", "HEAD"], handle: health.handle },
};

// Exact match, with or without a trailing slash.
export function findRoute(pathname: string): Route | undefined {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return ROUTES[path];
}
