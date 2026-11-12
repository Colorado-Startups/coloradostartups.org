// formIntake() and turnstileError() in worker/lib/forms.ts, the steps every
// form route shares. The route tests (l19, l2, l3, l6) cover each route end to
// end; this file covers the options and the order the helpers promise.
// Turnstile goes through MSW.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { formIntake, turnstileError, type FormIntakeOptions } from "../../worker/lib/forms";
import { turnstileAccepting } from "./l3/turnstile-handlers";
import { server } from "./server";

const ORIGIN = "https://coloradostartups.org";
const ENDPOINT = `${ORIGIN}/api/test-form`;
const GOOD = "good-token";

const OPTS: FormIntakeOptions = {
  path: "/api/test-form",
  formPath: "/form/",
  thanksPath: "/form/thanks/",
  returnTo: (form) => (form.get("return_to") === "/other/" ? "/other/" : "/form/"),
};

const allowing = { FORM_RATE_LIMIT: { limit: async () => ({ success: true }) } };
const refusing = { FORM_RATE_LIMIT: { limit: async () => ({ success: false }) } };

const fields = (over: Record<string, string> = {}) => ({ ts: String(Date.now() - 10_000), ...over });

function post(entries: Record<string, string>, ip = "192.0.2.10"): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    body: new URLSearchParams(entries).toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": ip },
  });
}

const location = (res: unknown) => (res instanceof Response ? res.headers.get("Location") : null);

describe("formIntake", () => {
  it("answers a rate-limited post before beforeBody runs or the body is read", async () => {
    const request = post(fields());
    let beforeBodyCalls = 0;
    const res = await formIntake(request, refusing, {
      ...OPTS,
      beforeBody: () => {
        beforeBodyCalls += 1;
        return null;
      },
    });
    expect(location(res)).toBe(`${ORIGIN}/form/?error=ratelimit`);
    expect(beforeBodyCalls).toBe(0);
    expect(request.bodyUsed).toBe(false);
  });

  it("returns what beforeBody answers, with the body still unread", async () => {
    const request = post(fields());
    const res = await formIntake(request, allowing, { ...OPTS, beforeBody: () => new Response(null, { status: 415 }) });
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(415);
    expect(request.bodyUsed).toBe(false);
  });

  it("caps the body at maxBytes and sends an unreadable one to the form page", async () => {
    const head = new URLSearchParams(fields({ return_to: "/other/" })).toString() + "&pad=";
    const sized = (n: number) =>
      new Request(ENDPOINT, {
        method: "POST",
        body: head + "y".repeat(n - head.length),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    expect(await formIntake(sized(200), allowing, { ...OPTS, maxBytes: 200 })).not.toBeInstanceOf(Response);
    // The return path comes from the form, so a body never read cannot pick it.
    expect(location(await formIntake(sized(201), allowing, { ...OPTS, maxBytes: 200 }))).toBe(`${ORIGIN}/form/?error=invalid`);
  });

  it("answers a filled honeypot with the thanks page before the speed check", async () => {
    const res = await formIntake(post(fields({ website: "spam", ts: String(Date.now()) })), allowing, OPTS);
    expect(location(res)).toBe(`${ORIGIN}/form/thanks/`);
  });

  it("sends a post that came too fast to the path returnTo picked", async () => {
    const res = await formIntake(post(fields({ ts: String(Date.now()), return_to: "/other/" })), allowing, OPTS);
    expect(location(res)).toBe(`${ORIGIN}/other/?error=verification`);
  });

  it("hands a post that passed every step back with its form and return path", async () => {
    const res = await formIntake(post(fields({ name: "Sam", return_to: "/other/" })), allowing, OPTS);
    expect(res).not.toBeInstanceOf(Response);
    const intake = res as Exclude<typeof res, Response>;
    expect(intake.form.get("name")).toBe("Sam");
    expect(intake.returnTo).toBe("/other/");
    expect(intake.url.href).toBe(ENDPOINT);
  });

  it("keys the rate limit by visitor IP and route path", async () => {
    const keys: string[] = [];
    const recording = { FORM_RATE_LIMIT: { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) } };
    await formIntake(post(fields(), "198.51.100.20"), recording, OPTS);
    expect(keys).toEqual(["198.51.100.20:/api/test-form"]);
  });
});

describe("turnstileError", () => {
  const formWith = (token: string | File | null) => {
    const f = new FormData();
    if (token !== null) f.append("cf-turnstile-response", token);
    return f;
  };
  const request = new Request(ENDPOINT, { method: "POST", headers: { "CF-Connecting-IP": "198.51.100.30" } });

  it("answers unavailable without the secret, and never calls siteverify", async () => {
    const seen: FormData[] = [];
    server.use(turnstileAccepting(GOOD, seen));
    expect(await turnstileError(formWith(GOOD), request, { TURNSTILE_SECRET_KEY: undefined })).toBe("unavailable");
    expect(seen).toEqual([]);
  });

  it("passes the good token and sends the secret and the visitor IP", async () => {
    const seen: FormData[] = [];
    server.use(turnstileAccepting(GOOD, seen));
    expect(await turnstileError(formWith(GOOD), request, env)).toBeNull();
    expect(seen[0]?.get("secret")).toBe("test-secret");
    expect(seen[0]?.get("remoteip")).toBe("198.51.100.30");
  });

  it("answers verification for a forged token", async () => {
    server.use(turnstileAccepting(GOOD));
    expect(await turnstileError(formWith("forged"), request, env)).toBe("verification");
  });

  it.each([
    ["a missing token", null],
    ["a file part in the token field", new File([GOOD], "token.txt")],
  ])("answers verification for %s without calling siteverify", async (_label, token) => {
    const seen: FormData[] = [];
    server.use(turnstileAccepting(GOOD, seen));
    expect(await turnstileError(formWith(token), request, env)).toBe("verification");
    expect(seen).toEqual([]);
  });
});
