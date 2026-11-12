import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { CSP_HEADER_NAME, CSP_VALUE } from "../../worker/lib/security-headers";
import { ROUTES } from "../../worker/routes";

const BASE = "https://coloradostartups.org";

describe("router", () => {
  it("answers an unknown /api path with a JSON 404 and security headers", async () => {
    const res = await SELF.fetch(`${BASE}/api/nope`, { method: "POST" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "invalid" });
    expect(res.headers.get(CSP_HEADER_NAME)).toBe(CSP_VALUE);
  });

  it("rejects the wrong method with 405 and an Allow header", async () => {
    const res = await SELF.fetch(`${BASE}/api/ask`, { method: "GET" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("accepts a trailing slash on API paths", async () => {
    const res = await SELF.fetch(`${BASE}/api/csp-report/`, { method: "POST", body: "{}" });
    expect(res.status).toBe(204);
  });

  // Every declared route is reachable with its first method. This asserts the
  // routing, not the handler: lane routes start as 501 stubs and become real
  // handlers, and each lane tests its own handler's behavior in
  // test/worker/<lane>/.
  // redirect "manual": form routes answer 303, and following it would hit a
  // page another lane has not built yet and report that page's 404 instead.
  it.each(Object.entries(ROUTES))("%s is routed (not 404 or 405)", async (path, route) => {
    const method = route.methods[0];
    const body = method === "GET" || method === "HEAD" ? undefined : "{}";
    const res = await SELF.fetch(`${BASE}${path}`, { method, body, redirect: "manual" });
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(405);
  });
});
