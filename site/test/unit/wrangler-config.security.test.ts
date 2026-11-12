import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseJsonc } from "../jsonc.mjs";

const cfg = parseJsonc(readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8")) as Record<string, any>;
const staging = cfg.env?.staging ?? {};

describe("wrangler.jsonc", () => {
  it("runs the Worker only for /api/*", () => {
    expect(cfg.assets.run_worker_first).toEqual(["/api/*"]);
  });

  it("minifies the Worker, which keeps its gzipped bundle under the 150 KB goal", () => {
    expect(cfg.minify).toBe(true);
  });

  it("keeps production off workers.dev and preview URLs", () => {
    expect(cfg.workers_dev).toBe(false);
    expect(cfg.preview_urls).toBe(false);
  });

  it("declares every binding in both production and staging", () => {
    for (const env of [cfg, staging]) {
      expect(env.ai?.binding).toBe("AI");
      expect(env.ai_search?.[0]?.binding).toBe("RESOURCUS_SEARCH");
      expect(env.d1_databases?.[0]?.binding).toBe("DB");
      expect(env.ratelimits?.map((r: { name: string }) => r.name).sort()).toEqual(["ASK_RATE_LIMIT", "FORM_RATE_LIMIT"]);
      expect(env.send_email?.[0]?.name).toBe("FORM_EMAIL");
    }
  });

  it("gives staging its own database and search instance", () => {
    expect(staging.d1_databases[0].database_name).not.toBe(cfg.d1_databases[0].database_name);
    expect(staging.ai_search[0].instance_name).not.toBe(cfg.ai_search[0].instance_name);
  });

  it("never inlines a secret", () => {
    const text = JSON.stringify(cfg);
    for (const name of ["TURNSTILE_SECRET_KEY", "KIT_API_KEY", "SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"]) {
      expect(text).not.toContain(`"${name}"`);
    }
  });
});
