// A rejected key records "HTTP <status>" and nothing from the response body.
//
// OpenAI's 401 body echoes a masked copy of the key (sk-proj-****abcd). The
// runner's key scrub only removes the exact key, so a masked copy would slip
// through into results files and logs. The fixture is that body, served by
// every provider's route at 401 and at 403. All of it runs offline.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { PROVIDER_IDS } from "../cost.ts";
import { main } from "../cli.ts";
import type { ResultsFile } from "../panel.ts";
import { HttpError, isAuthError, makePost } from "../providers.ts";
import { ANTHROPIC, FAKE_KEYS, fakeFetch, fixture, OPENAI, PERPLEXITY, testDeps } from "./helpers.ts";

const BODY = fixture("openai-401-masked-key.json");

/** Every string in the body, plus the masked key's two halves. */
function bodyFragments(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (v !== null && typeof v === "object") return Object.values(v).flatMap(bodyFragments);
  return [];
}
const FRAGMENTS = [...bodyFragments(BODY), "sk-proj-", "****abcd"];

function allWritten(dir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(readFileSync(p, "utf8"));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.join("\n");
}

function assertNoBody(text: string, where: string): void {
  for (const f of FRAGMENTS) assert.ok(!text.includes(f), `${where} contains ${JSON.stringify(f)} from the response body`);
}

describe("auth errors keep no part of the response body", () => {
  it("the fixture really holds a masked key", () => {
    assert.ok(JSON.stringify(BODY).includes("sk-proj-****abcd"));
  });

  for (const status of [401, 403]) {
    it(`makePost throws "HTTP ${status}" alone`, async () => {
      const { fetch } = fakeFetch({ "https://x.example/": [{ status, body: BODY }] });
      const post = makePost({ fetch, sleep: async () => {}, timeoutMs: 1000, retries: 2 });
      await assert.rejects(post("https://x.example/", {}, {}), (err) => {
        assert.ok(err instanceof HttpError && isAuthError(err));
        assert.equal(err.message, `HTTP ${status}`);
        assertNoBody(err.message, "the error message");
        return true;
      });
    });

    it(`every provider records "HTTP ${status}" in its results file and log`, async () => {
      const reply = [{ status, body: BODY }];
      const { fetch, calls } = fakeFetch({ [ANTHROPIC]: reply, [OPENAI]: reply, [PERPLEXITY]: reply });
      const deps = testDeps({ fetch, env: { ...FAKE_KEYS } });
      // No provider answered a question, so the run exits 3 (could not check).
      assert.equal(await main(["--live", "--confirm-spend", "--questions", "v01,v02"], deps), 3);
      assert.equal(calls.length, PROVIDER_IDS.length, "one request per provider, then it stops asking");
      for (const id of PROVIDER_IDS) {
        const r = JSON.parse(readFileSync(path.join(deps.resultsDir!, `2026-10-18-${id}.json`), "utf8")) as ResultsFile;
        assert.equal(r.answers[0]!.error, `HTTP ${status}`, `${id} first answer`);
        assert.match(r.answers[1]!.error ?? "", /^skipped: the provider rejected /, `${id} second answer`);
      }
      assertNoBody(allWritten(deps.dir), "a file the run wrote");
      assertNoBody(deps.lines.join("\n"), "the run log");
    });
  }
});
