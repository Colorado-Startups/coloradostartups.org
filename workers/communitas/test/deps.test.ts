import { describe, expect, it } from "vitest";

import { depsFromEnv } from "../src/deps";

function envWith(limit: () => Promise<{ success: boolean }>, over: Partial<Env> = {}): Env {
  return {
    COMMUNITAS_PAUSED: "true",
    SITE_ORIGIN: "https://coloradostartups.org/",
    SLACK_ASK_LIMIT: { limit } as unknown as RateLimit,
    RESOURCUS: {} as never,
    USER_KEY_SALT: "salt",
    ...over,
  } as Env;
}

describe("depsFromEnv", () => {
  it("passes the rate limiter's verdict through", async () => {
    expect(await depsFromEnv(envWith(async () => ({ success: false }))).allowAsk("k")).toBe(false);
    expect(await depsFromEnv(envWith(async () => ({ success: true }))).allowAsk("k")).toBe(true);
  });

  it("fails open when the rate limiter errors (the site's budget guard is the spending stop)", async () => {
    const deps = depsFromEnv(
      envWith(async () => {
        throw new Error("limiter down");
      }),
    );
    expect(await deps.allowAsk("k")).toBe(true);
  });

  it("drops a trailing slash from SITE_ORIGIN so links never double it", () => {
    expect(depsFromEnv(envWith(async () => ({ success: true }))).siteOrigin).toBe("https://coloradostartups.org");
  });

  it("treats an empty threads channel as unset", () => {
    const deps = depsFromEnv(envWith(async () => ({ success: true }), { COMMUNITAS_THREADS_CHANNEL: "" }));
    expect(deps.threadsChannel).toBeUndefined();
  });
});
