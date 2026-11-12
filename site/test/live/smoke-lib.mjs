// Pure logic for the live smoke test (smoke.mjs): the pages, the payloads and
// the judging rules. It imports only the shared JSONC reader (../jsonc.mjs,
// also pure) and touches no network, so the unit project (plain Node) and the
// worker project (workerd) both import it:
//   - test/unit/l11/smoke.test.ts runs the judging rules on canned answers;
//   - test/worker/l11/smoke.test.ts sends these exact payloads through the real
//     routes, so a form change that breaks a payload fails a test, not a smoke run.
//
// Result levels: ok, PENDING (a page another lane has not shipped yet), WARN
// (a heuristic said no), FAIL (a certain fault), CANNOT (could not check).
// Exit codes match the repo's gates: 0 clean, 1 a FAIL, 3 could not check.

import { parseJsonc } from "../jsonc.mjs";

// Any string other than a real token fails siteverify against the real secret.
export const BAD_TOKEN = "smoke-invalid-token";

// The nav pages and feeds. A 404 means the owning lane has not shipped the page.
export const NAV_PAGES = [
  { path: "/", kind: "html" },
  { path: "/community/", kind: "html" },
  { path: "/ecosystem-canvas/", kind: "html" },
  { path: "/leaderboard/", kind: "html" },
  { path: "/regions/", kind: "html" },
  { path: "/team/", kind: "html" },
  { path: "/get-involved/", kind: "html" },
  { path: "/founders/", kind: "html" },
  { path: "/newsletter/", kind: "html" },
  { path: "/event-calendar/", kind: "html" },
  { path: "/links/", kind: "html" },
  { path: "/code-of-conduct/", kind: "html" },
  { path: "/privacy/", kind: "html" },
  { path: "/contact/", kind: "html" },
  { path: "/dispatches/", kind: "html" },
  { path: "/feed.json", kind: "json" },
  { path: "/rss.xml", kind: "xml" },
];

const CONTENT_TYPES = { html: "text/html", json: "json", xml: "xml" };

// A submitted-at stamp old enough to pass the speed check (MIN_SUBMIT_MS is
// 3,000 ms in worker/lib/config.ts).
const stamp = (now) => String(now - 10_000);

// The three HTML form routes. Field values are fixed test values on the
// reserved example.com and example.org domains (RFC 2606), never contact data.
// `unavailable` says what an "unavailable" answer means for that route:
// subscribe checks for its Kit secrets before Turnstile, so there it means
// "Kit is not set up yet"; the other two return it only when
// TURNSTILE_SECRET_KEY is missing.
export const FORM_ROUTES = [
  {
    path: "/api/subscribe",
    thanks: "/newsletter/thanks/",
    limiter: "FORM_RATE_LIMIT",
    unavailable: "pending",
    writes: "a Kit subscriber",
    fields: (now) => ({
      email: "smoke-test@example.com",
      return_to: "/newsletter/",
      ts: stamp(now),
      "cf-turnstile-response": BAD_TOKEN,
    }),
  },
  {
    path: "/api/nominate",
    thanks: "/leaderboard/nominate/thanks/",
    limiter: "FORM_RATE_LIMIT",
    unavailable: "fail",
    writes: "a nominations row",
    fields: (now) => ({
      legal_name: "Smoke Test Co (not a real company)",
      company_website: "https://example.com",
      hq_city: "Denver",
      hq_county: "Denver",
      founded_year: "2020",
      private_independent_for_profit: "on",
      base_year: "2024",
      base_year_revenue_usd: "1000",
      current_year_revenue_usd: "2000",
      fte_headcount: "5",
      sector: "Software",
      contact_name: "Smoke Test",
      contact_email: "smoke-test@example.com",
      consent_to_publish: "on",
      attestation: "on",
      return_to: "/leaderboard/nominate/",
      ts: stamp(now),
      "cf-turnstile-response": BAD_TOKEN,
    }),
  },
  {
    path: "/api/suggest-resource",
    thanks: "/ecosystem-canvas/suggest/thanks/",
    limiter: "FORM_RATE_LIMIT",
    unavailable: "fail",
    writes: "a resource_suggestions row",
    fields: (now) => ({
      name: "Smoke test resource",
      url: "https://example.org/smoke",
      note: "Sent by site/test/live/smoke.mjs. Not a real suggestion.",
      return_to: "/ecosystem-canvas/suggest/",
      ts: stamp(now),
      "cf-turnstile-response": BAD_TOKEN,
    }),
  },
  {
    // A payload that passes ApplicationSchema, so the route reaches Turnstile.
    // The badge links are on the allowed host and point nowhere real; the
    // Worker never visits a link (BRIEF constraint 12).
    path: "/api/apply",
    thanks: "/get-involved/apply/thanks/",
    limiter: "FORM_RATE_LIMIT",
    unavailable: "fail",
    writes: "an applications row",
    fields: (now) => ({
      role: "photon-mountain-connector",
      name: "Smoke Test (not a person)",
      email: "smoke-test@example.com",
      based_in: "Denver",
      why: "Sent by site/test/live/smoke.mjs. Not a real application.",
      "badge_claude-101": "https://academy.claude.com/verify/smoke-test",
      "badge_ai-fluency-framework-foundations": "https://academy.claude.com/verify/smoke-test",
      "badge_ai-fluency-for-small-businesses": "https://academy.claude.com/verify/smoke-test",
      consent: "on",
      ts: stamp(now),
      "cf-turnstile-response": BAD_TOKEN,
    }),
  },
];

// The JSON route. No sessionId, so the Worker must check the token.
export const ASK_ROUTE = {
  path: "/api/ask",
  limiter: "ASK_RATE_LIMIT",
  body: () => ({ question: "Where can I find a startup accelerator in Denver?", turnstileToken: BAD_TOKEN }),
};

const result = (level, check, detail) => ({ level, check, detail });

export function isAccessRedirect(status, location) {
  return status >= 300 && status < 400 && /\.cloudflareaccess\.com\//i.test(location ?? "");
}

// Without the token, staging must refuse: a login redirect or a 401/403.
export function judgeAccessGate(status, location) {
  const check = "access: no token is refused";
  if (status === 200) return result("FAIL", check, "answered 200 without the Access token: staging is public");
  if (isAccessRedirect(status, location) || status === 401 || status === 403) {
    return result("ok", check, `${status}`);
  }
  return result("WARN", check, `unexpected ${status} without the token`);
}

export function judgePage(page, status, contentType, location) {
  const check = `page ${page.path}`;
  if (isAccessRedirect(status, location)) return result("CANNOT", check, "Access refused the service token");
  if (status === 404) return result("PENDING", check, "404, not shipped yet");
  if (status !== 200) return result("FAIL", check, `${status}${location ? ` -> ${location}` : ""}`);
  const want = CONTENT_TYPES[page.kind];
  if (!(contentType ?? "").toLowerCase().includes(want)) {
    return result("FAIL", check, `200 but Content-Type "${contentType ?? ""}", want ${want}`);
  }
  return result("ok", check, "200");
}

// The "/*" block of a Workers _headers file, as [name, value] pairs.
export function parseHeadersFile(text) {
  const out = [];
  let inAll = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      inAll = line.trim() === "/*";
      continue;
    }
    if (!inAll) continue;
    const i = line.indexOf(":");
    if (i > 0) out.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
  return out;
}

// One result per expected header. `actual` is a Headers object or anything
// with get(name).
export function judgeHeaders(expected, actual, where) {
  return expected.map(([name, value]) => {
    const got = actual.get(name);
    const check = `header ${name} (${where})`;
    if (got === null || got === undefined) return result("FAIL", check, "missing");
    if (got !== value) return result("FAIL", check, `"${got}", want "${value}"`);
    return result("ok", check, "matches public/_headers");
  });
}

// A form route answers with a 303 whose Location carries ?error=<enum>.
export function formOutcome(status, location) {
  if (isAccessRedirect(status, location)) return "access";
  if (status !== 303 || !location) return `http-${status}`;
  const target = new URL(location, "https://smoke.invalid");
  return target.searchParams.get("error") ?? `to:${target.pathname}`;
}

export function judgeFormToken(route, status, location) {
  const check = `turnstile ${route.path}`;
  const outcome = formOutcome(status, location);
  switch (outcome) {
    case "verification":
      return result("ok", check, "rejected the bad token");
    case "unavailable":
      return route.unavailable === "pending"
        ? result("PENDING", check, "Kit secrets not set, so the route stops before Turnstile")
        : result("FAIL", check, "TURNSTILE_SECRET_KEY is not set, so the form is closed");
    case "ratelimit":
      return result("CANNOT", check, "still rate limited from an earlier run; wait 60 s and rerun");
    case "invalid":
      return result("CANNOT", check, "the smoke payload no longer validates; update smoke-lib.mjs");
    case "delivery":
      return result("FAIL", check, `the bad token got past Turnstile and tried to write ${route.writes}`);
    case "access":
      return result("CANNOT", check, "Access refused the service token");
    default:
      if (outcome === `to:${route.thanks}`) {
        return result("FAIL", check, `accepted a bad Turnstile token; delete ${route.writes} it created`);
      }
      return result("FAIL", check, `unexpected answer: ${outcome}`);
  }
}

export function judgeAskToken(status, body) {
  const check = `turnstile ${ASK_ROUTE.path}`;
  const error = body && typeof body === "object" ? body.error : undefined;
  if (status === 403 && error === "verification") return result("ok", check, "rejected the bad token");
  if (status === 200) return result("FAIL", check, "answered a question with a bad Turnstile token");
  if (status === 429) return result("CANNOT", check, "still rate limited from an earlier run; wait 60 s and rerun");
  if (status === 400) return result("CANNOT", check, "the smoke payload no longer validates; update smoke-lib.mjs");
  return result("FAIL", check, `unexpected ${status}${error ? ` (${error})` : ""}`);
}

// `outcomes` holds one entry per burst request: "ratelimit", "infra", or
// anything else. The limiter is "permissive, eventually consistent" and local
// to each Cloudflare location (developers.cloudflare.com/workers/runtime-apis/
// bindings/rate-limit/), so no limit answer is a WARN, never a FAIL.
export function judgeBurst(path, outcomes, limit) {
  const check = `burst ${path}`;
  const hit = outcomes.indexOf("ratelimit");
  if (hit >= 0) return result("ok", check, `limited at request ${hit + 1} (limit ${limit} per 60 s)`);
  if (outcomes.includes("infra")) return result("CANNOT", check, "requests failed before any limit answer");
  return result(
    "WARN",
    check,
    `no rate-limit answer in ${outcomes.length} requests; the limiter is permissive, so rerun once before calling it a fault`,
  );
}

// ops/redirects/test.mjs prints "FAIL <old>: target <new> answered 404" when the
// 301 is right but its target page is not built yet.
const PENDING_TARGET = /^FAIL \S+: target (\S+) answered 404$/;

// The redirect test exits 0, 1, 2 or 3; `lines` is its output. When every
// failure is a target that 404s, the redirects are right and the pages are
// still to come, which is PENDING like a 404 nav page.
export function judgeRedirects(code, lines) {
  const check = "redirects ops/redirects/map.csv";
  const summary = lines.at(-1) ?? "no output";
  if (code === 0) return result("ok", check, summary);
  if (code === 1) {
    const fails = lines.filter((l) => l.startsWith("FAIL"));
    const targets = fails.map((l) => PENDING_TARGET.exec(l)?.[1]);
    if (fails.length > 0 && targets.every(Boolean)) {
      return result("PENDING", check, `301s are right; targets not shipped yet: ${[...new Set(targets)].join(", ")}`);
    }
    return result("FAIL", check, summary);
  }
  return result("CANNOT", check, `exit ${code}: ${summary}`);
}

// Redirect targets that name a section (#fragment) of their page, from the
// map's rows ({ old, to }). One entry per distinct target.
export function fragmentTargets(rows) {
  const seen = new Map();
  for (const { to } of rows) {
    const i = to.indexOf("#");
    if (i > 0 && !seen.has(to)) seen.set(to, { page: to.slice(0, i), id: to.slice(i + 1) });
  }
  return [...seen.values()];
}

// The section a redirect lands on must exist on its page as an element id.
export function judgeAnchor(target, status, html) {
  const check = `anchor ${target.page}#${target.id}`;
  if (status === 404) return result("PENDING", check, "page not shipped yet");
  if (status !== 200) return result("FAIL", check, `page answered ${status}`);
  const escaped = target.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\bid=["']?${escaped}["'\\s/>]`).test(html ?? "")) return result("ok", check, "the id is on the page");
  return result("PENDING", check, "the page has no element with this id yet");
}

// Rate-limit binding name -> limit, for the top level or one environment.
// site/wrangler.jsonc is the one definition of these numbers.
export function rateLimits(config, envName) {
  const block = envName ? (config.env?.[envName] ?? {}) : config;
  const out = {};
  for (const r of block.ratelimits ?? []) out[r.name] = r.simple?.limit;
  return out;
}

export function exitCode(results) {
  if (results.some((r) => r.level === "FAIL")) return 1;
  if (results.some((r) => r.level === "CANNOT")) return 3;
  return 0;
}

export function tally(results) {
  const n = { ok: 0, PENDING: 0, WARN: 0, FAIL: 0, CANNOT: 0 };
  for (const r of results) n[r.level]++;
  return `${n.FAIL} failed, ${n.CANNOT} could not check, ${n.WARN} warned, ${n.PENDING} pending, ${n.ok} ok`;
}

// Seeded known-bad and known-clean samples: each must land on its level.
export const SELF_TEST_CASES = [
  ["access public", () => judgeAccessGate(200, null), "FAIL"],
  ["access login", () => judgeAccessGate(302, "https://cs.cloudflareaccess.com/cdn-cgi/access/login/x"), "ok"],
  ["page live", () => judgePage(NAV_PAGES[0], 200, "text/html; charset=utf-8", null), "ok"],
  ["page pending", () => judgePage(NAV_PAGES[4], 404, "text/html", null), "PENDING"],
  ["page broken", () => judgePage(NAV_PAGES[0], 500, "text/html", null), "FAIL"],
  ["feed wrong type", () => judgePage(NAV_PAGES[15], 200, "text/html", null), "FAIL"],
  ["page behind access", () => judgePage(NAV_PAGES[0], 302, "text/html", "https://cs.cloudflareaccess.com/cdn-cgi/access/login/x"), "CANNOT"],
  ["header ok", () => judgeHeaders([["X-Frame-Options", "DENY"]], new Headers({ "x-frame-options": "DENY" }), "t")[0], "ok"],
  ["header missing", () => judgeHeaders([["X-Frame-Options", "DENY"]], new Headers(), "t")[0], "FAIL"],
  ["token rejected", () => judgeFormToken(FORM_ROUTES[1], 303, "https://h/leaderboard/nominate/?error=verification"), "ok"],
  ["token accepted", () => judgeFormToken(FORM_ROUTES[1], 303, "https://h/leaderboard/nominate/thanks/"), "FAIL"],
  ["kit unset", () => judgeFormToken(FORM_ROUTES[0], 303, "https://h/newsletter/?error=unavailable"), "PENDING"],
  ["secret unset", () => judgeFormToken(FORM_ROUTES[2], 303, "https://h/ecosystem-canvas/suggest/?error=unavailable"), "FAIL"],
  ["stale payload", () => judgeFormToken(FORM_ROUTES[2], 303, "https://h/ecosystem-canvas/suggest/?error=invalid"), "CANNOT"],
  ["ask rejected", () => judgeAskToken(403, { error: "verification" }), "ok"],
  ["ask answered", () => judgeAskToken(200, { answer: "x" }), "FAIL"],
  ["burst limited", () => judgeBurst("/api/nominate", ["verification", "ratelimit"], 10), "ok"],
  ["burst never limited", () => judgeBurst("/api/nominate", ["verification", "verification"], 10), "WARN"],
  ["redirects broken", () => judgeRedirects(1, ["FAIL /home: 200 -> (no Location), want 301 -> /", "1 failed, 0 unreachable"]), "FAIL"],
  [
    "redirect targets pending",
    () => judgeRedirects(1, ["ok   /home -> /", "FAIL /the-team: target /team/ answered 404", "1 failed, 0 unreachable"]),
    "PENDING",
  ],
  [
    "redirect target 404 beside a wrong 301",
    () =>
      judgeRedirects(1, [
        "FAIL /the-team: target /team/ answered 404",
        "FAIL /about: 302 -> /team/, want 301 -> /team/",
        "2 failed, 0 unreachable",
      ]),
    "FAIL",
  ],
  ["redirect target 500", () => judgeRedirects(1, ["FAIL /the-team: target /team/ answered 500", "1 failed, 0 unreachable"]), "FAIL"],
  ["anchor present", () => judgeAnchor({ page: "/e/", id: "a-b" }, 200, '<h2 id="a-b">x</h2>'), "ok"],
  ["anchor missing", () => judgeAnchor({ page: "/e/", id: "a-b" }, 200, '<h2 id="a-bc">x</h2>'), "PENDING"],
  ["anchor page broken", () => judgeAnchor({ page: "/e/", id: "a-b" }, 500, ""), "FAIL"],
];

export function runSelfTest() {
  const wrong = [];
  for (const [name, run, want] of SELF_TEST_CASES) {
    const got = run().level;
    if (got !== want) wrong.push(`${name}: got ${got}, want ${want}`);
  }
  // The shared reader (#395): a string's ", ]" keeps its comma, and an
  // unclosed comment throws instead of passing.
  const parsed = parseJsonc('{ "a": "http://x//y", "s": "x, ]", /* c */ "b": [1, 2,], // tail\n }');
  if (parsed.a !== "http://x//y" || parsed.s !== "x, ]" || parsed.b.length !== 2) wrong.push("parseJsonc mangled a string or a list");
  try {
    parseJsonc('{ "a": 1 /* open');
    wrong.push("parseJsonc accepted an unclosed comment");
  } catch {
    // Expected: an unclosed comment is a syntax error.
  }
  return wrong;
}
