// Sends the live smoke test's own payloads (site/test/live/smoke-lib.mjs)
// through the real routes in workerd, then judges the answers with the smoke's
// own rules. A form change that would make a payload stale, or a thanks path
// that drifts, fails here instead of during a staging run.
//
// Turnstile is mocked: only GOOD_TOKEN passes, as with a real secret, so the
// smoke's BAD_TOKEN must be rejected.

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { ASK_ROUTE, BAD_TOKEN, FORM_ROUTES, judgeAskToken, judgeFormToken } from "../../live/smoke-lib.mjs";
import { kitHandlers } from "../l6/kit-handlers";
import { turnstileAccepting } from "../l3/turnstile-handlers";
import { server } from "../server";

const BASE = "https://coloradostartups.org";
const GOOD_TOKEN = "l11-good-token";

let ipSeq = 0;
const nextIp = () => `198.51.100.${++ipSeq}`;

function postForm(path: string, fields: Record<string, string>) {
  return SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    body: new URLSearchParams(fields),
    headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": nextIp() },
    redirect: "manual",
  });
}

describe("smoke payloads against the real routes", () => {
  it.each(FORM_ROUTES.map((r) => [r.path, r] as const))("%s rejects the smoke's bad token", async (_path, route) => {
    const seen: FormData[] = [];
    server.use(turnstileAccepting(GOOD_TOKEN, seen));
    const res = await postForm(route.path, route.fields(Date.now()));
    expect(judgeFormToken(route, res.status, res.headers.get("location"))).toMatchObject({ level: "ok" });
    // The payload got as far as Turnstile, with the bad token.
    expect(seen.map((f) => f.get("response"))).toEqual([BAD_TOKEN]);
  });

  it.each(FORM_ROUTES.map((r) => [r.path, r] as const))(
    "%s with a passing token lands where the smoke expects its thanks page",
    async (_path, route) => {
      server.use(turnstileAccepting(GOOD_TOKEN), ...kitHandlers().handlers);
      const res = await postForm(route.path, { ...route.fields(Date.now()), "cf-turnstile-response": GOOD_TOKEN });
      expect(new URL(res.headers.get("location") ?? "", BASE).pathname).toBe(route.thanks);
      expect(judgeFormToken(route, res.status, res.headers.get("location"))).toMatchObject({ level: "FAIL" });
    },
  );

  it("/api/ask rejects the smoke's bad token before any model call", async () => {
    const seen: FormData[] = [];
    server.use(turnstileAccepting(GOOD_TOKEN, seen));
    const res = await SELF.fetch(`${BASE}${ASK_ROUTE.path}`, {
      method: "POST",
      body: JSON.stringify(ASK_ROUTE.body()),
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": nextIp() },
    });
    expect(judgeAskToken(res.status, await res.json())).toMatchObject({ level: "ok" });
    expect(seen.map((f) => f.get("response"))).toEqual([BAD_TOKEN]);
  });

  it("burst requests stop before Turnstile", async () => {
    const seen: FormData[] = [];
    server.use(turnstileAccepting(GOOD_TOKEN, seen));
    for (const route of FORM_ROUTES) {
      const res = await SELF.fetch(`${BASE}${route.path}`, {
        method: "POST",
        body: "",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": nextIp() },
        redirect: "manual",
      });
      expect(res.status, route.path).toBe(303);
    }
    expect(seen).toEqual([]);
  });
});
