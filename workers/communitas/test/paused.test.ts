import { createScheduledController, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import worker from "../src/index";
import { isPaused } from "../src/pause";

describe("Communitas ships paused", () => {
  it("reads COMMUNITAS_PAUSED from wrangler.jsonc as paused", () => {
    expect(isPaused(env)).toBe(true);
  });

  it("treats anything but the exact string false as paused", () => {
    expect(isPaused({ COMMUNITAS_PAUSED: "false" })).toBe(false);
    expect(isPaused({ COMMUNITAS_PAUSED: "FALSE" } as never)).toBe(true);
    expect(isPaused({ COMMUNITAS_PAUSED: "" } as never)).toBe(true);
  });

  it("reports paused on the health check", async () => {
    const res = await SELF.fetch("https://communitas.example/");
    expect(await res.text()).toBe("Communitas is paused.");
  });

  it("rejects unsigned Slack traffic with 401 while paused", async () => {
    const res = await SELF.fetch("https://communitas.example/slack/events", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("does nothing on the cron while paused", async () => {
    await expect(
      worker.scheduled(createScheduledController({ cron: "0 15 * * 1" }), env),
    ).resolves.toBeUndefined();
  });

  it("refuses a GET on the Slack routes", async () => {
    const res = await SELF.fetch("https://communitas.example/slack/events");
    expect(res.status).toBe(405);
  });

  it("answers 404 off the known routes", async () => {
    const res = await SELF.fetch("https://communitas.example/slack/other", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
