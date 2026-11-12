// The runner end to end, offline: the dry run, the spend gate, the missing
// key, a full live run against recorded responses, and the safety stops.

import assert from "node:assert/strict";
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { denverDate, main } from "../cli.ts";
import type { ResultsFile } from "../panel.ts";
import { FAKE_KEYS, fakeFetch, happyRoutes, OPENAI, ROOT, testDeps } from "./helpers.ts";

function allWritten(dir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, name.name);
      if (name.isDirectory()) walk(p);
      else out.push(readFileSync(p, "utf8"));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.join("\n");
}

describe("dry run", () => {
  it("prints the question count, the providers and a sourced estimate, and sends nothing", async () => {
    const { fetch, calls } = fakeFetch({});
    const deps = testDeps({ fetch });
    assert.equal(await main([], deps), 0);
    const out = deps.lines.join("\n");
    assert.match(out, /20 questions, 3 providers \(anthropic, openai, perplexity\)/);
    assert.match(out, /Estimated total: \$7\.30 for 60 answers/);
    assert.match(out, /platform\.claude\.com\/docs\/en\/about-claude\/pricing, read 2026-10-18/);
    assert.match(out, /developers\.openai\.com\/api\/docs\/pricing, read 2026-10-18/);
    assert.match(out, /docs\.perplexity\.ai\/getting-started\/pricing, read 2026-10-18/);
    assert.match(out, /assumptions, not measurements/);
    assert.match(out, /Dry run: nothing was sent/);
    assert.equal(calls.length, 0);
  });

  it("reports which keys are set, by name only", async () => {
    const deps = testDeps({ env: { ANTHROPIC_API_KEY: FAKE_KEYS.ANTHROPIC_API_KEY } });
    assert.equal(await main([], deps), 0);
    const out = deps.lines.join("\n");
    assert.match(out, /ANTHROPIC_API_KEY is set/);
    assert.match(out, /OPENAI_API_KEY is NOT set/);
    assert.ok(!out.includes(FAKE_KEYS.ANTHROPIC_API_KEY));
  });
});

describe("spend gate", () => {
  it("refuses --live without --confirm-spend, after printing the estimate, and sends nothing", async () => {
    const { fetch, calls } = fakeFetch(happyRoutes());
    const deps = testDeps({ fetch, env: { ...FAKE_KEYS } });
    assert.equal(await main(["--live"], deps), 2);
    const out = deps.lines.join("\n");
    assert.match(out, /Estimated total/);
    assert.match(out, /Refused: a live run spends money/);
    assert.equal(calls.length, 0);
    assert.equal(existsSync(deps.resultsDir!), false);
  });

  it("exits 3 when a key is missing, names the variable, and sends nothing", async () => {
    const { fetch, calls } = fakeFetch(happyRoutes());
    const env = { ANTHROPIC_API_KEY: FAKE_KEYS.ANTHROPIC_API_KEY, PERPLEXITY_API_KEY: "   " };
    const deps = testDeps({ fetch, env });
    assert.equal(await main(["--live", "--confirm-spend"], deps), 3);
    const out = deps.lines.join("\n");
    assert.match(out, /Could not check: OPENAI_API_KEY, PERPLEXITY_API_KEY not set/);
    assert.ok(!out.includes(FAKE_KEYS.ANTHROPIC_API_KEY));
    assert.equal(calls.length, 0);
  });

  it("runs one provider when only that provider is picked and keyed", async () => {
    const { fetch, calls } = fakeFetch(happyRoutes());
    const deps = testDeps({ fetch, env: { ANTHROPIC_API_KEY: FAKE_KEYS.ANTHROPIC_API_KEY } });
    assert.equal(await main(["--live", "--confirm-spend", "--providers", "anthropic", "--questions", "v01"], deps), 0);
    assert.ok(calls.every((c) => c.url.startsWith("https://api.anthropic.com/")));
  });
});

describe("live run, recorded responses", () => {
  it("writes one results file per provider and a summary, scored, with no key anywhere", async () => {
    const { fetch, calls } = fakeFetch(happyRoutes());
    const deps = testDeps({ fetch, env: { ...FAKE_KEYS } });
    copyFileSync(path.join(ROOT, "REPORT.md"), deps.reportFile!);
    const code = await main(["--live", "--confirm-spend", "--questions", "v01,v12", "--write-report"], deps);
    writeFileSync(path.join(deps.dir, "log.txt"), deps.lines.join("\n"));
    assert.equal(code, 0);

    // 2 questions: Anthropic pauses once per question, so 4 calls; 2 each for the others.
    assert.equal(calls.length, 8);
    const date = "2026-10-18";
    const files = readdirSync(deps.resultsDir!).sort();
    assert.deepEqual(files, [`${date}-anthropic.json`, `${date}-openai.json`, `${date}-perplexity.json`, `${date}-summary.md`]);

    const read = (id: string) => JSON.parse(readFileSync(path.join(deps.resultsDir!, `${date}-${id}.json`), "utf8")) as ResultsFile;
    const a = read("anthropic");
    assert.equal(a.model, "claude-sonnet-5-5");
    assert.equal(a.answers.length, 2);
    assert.deepEqual(
      a.answers.map((x) => [x.id, x.score?.named, x.score?.cited, x.score?.position?.rank]),
      [
        ["v01", true, true, 2],
        ["v12", true, true, 2],
      ],
    );
    assert.equal(a.summary.named, 2);
    assert.equal(a.summary.searches, 6);
    assert.ok(a.summary.costUsd > 0);

    const o = read("openai");
    assert.deepEqual(o.answers[0]!.score?.citedVia, ["citation", "text"]);
    const p = read("perplexity");
    assert.equal(p.summary.namedFirst, 2);

    const summary = readFileSync(path.join(deps.resultsDir!, `${date}-summary.md`), "utf8");
    assert.match(summary, /\| anthropic \| `claude-sonnet-5-5` \| 2\/2 \| 2\/2 \| 0\/2 \| 2 \|/);
    assert.match(summary, /\| v01 \| community \| statewide \| named #2, cited \| named #3, cited \| named #1, cited \|/);
    assert.match(summary, /\| coloradostartups\.org \| 6 \|/);
    assert.match(summary, /The runner estimated \$0\.73 before the run/);
    const report = readFileSync(deps.reportFile!, "utf8");
    assert.match(report, /<!-- results:start -->\nRun: 2026-10-18, live\./);
    assert.match(report, /\| perplexity \| `sonar` \| 2\/2 \| 2\/2 \| 2\/2 \| 1 \|/);

    // The key values went out only in request headers.
    for (const c of calls) assert.ok(!JSON.stringify(c.body).includes("fake-"));
    const written = allWritten(deps.dir);
    for (const key of Object.values(FAKE_KEYS)) assert.ok(!written.includes(key), `${key} leaked into a written file`);
  });

  it("files a labelled run apart from the day's baseline", async () => {
    const { fetch } = fakeFetch(happyRoutes());
    const deps = testDeps({ fetch, env: { ...FAKE_KEYS } });
    assert.equal(await main(["--live", "--confirm-spend", "--questions", "v01", "--date", "2026-10-18-smoke"], deps), 0);
    assert.ok(existsSync(path.join(deps.resultsDir!, "2026-10-18-smoke-anthropic.json")));
    assert.ok(existsSync(path.join(deps.resultsDir!, "2026-10-18-smoke-summary.md")));
  });

  it("files an evening run under the Denver date", () => {
    assert.equal(denverDate(new Date("2026-10-19T01:30:00Z")), "2026-10-18");
  });

  it("refuses to overwrite a day's results without --overwrite", async () => {
    const { fetch, calls } = fakeFetch(happyRoutes());
    const deps = testDeps({ fetch, env: { ...FAKE_KEYS } });
    const args = ["--live", "--confirm-spend", "--questions", "v01", "--providers", "perplexity"];
    assert.equal(await main(args, deps), 0);
    const before = calls.length;
    assert.equal(await main(args, deps), 2);
    assert.equal(calls.length, before, "the refused run sent nothing");
    assert.equal(await main([...args, "--overwrite"], deps), 0);
  });

  it("stops asking a provider whose key is rejected, scrubs the key, and exits 3", async () => {
    const routes = happyRoutes();
    routes[OPENAI] = [{ status: 401, body: { error: { message: `Incorrect API key provided: ${FAKE_KEYS.OPENAI_API_KEY}` } } }];
    const { fetch, calls } = fakeFetch(routes);
    const deps = testDeps({ fetch, env: { ...FAKE_KEYS } });
    assert.equal(await main(["--live", "--confirm-spend", "--questions", "v01,v02,v03"], deps), 3);
    assert.equal(calls.filter((c) => c.url.startsWith(OPENAI)).length, 1);
    const o = JSON.parse(readFileSync(path.join(deps.resultsDir!, "2026-10-18-openai.json"), "utf8")) as ResultsFile;
    assert.equal(o.summary.answered, 0);
    assert.match(o.answers[0]!.error ?? "", /HTTP 401/);
    assert.match(o.answers[1]!.error ?? "", /skipped: the provider rejected OPENAI_API_KEY/);
    assert.ok(!allWritten(deps.dir).includes(FAKE_KEYS.OPENAI_API_KEY));
    assert.ok(!deps.lines.join("\n").includes(FAKE_KEYS.OPENAI_API_KEY));
  });

  it("stops a provider whose spend passes twice its estimate", async () => {
    const huge = { choices: [{ message: { content: "Hi." }, finish_reason: "stop" }], citations: [], usage: { prompt_tokens: 50_000_000, completion_tokens: 0 } };
    const { fetch, calls } = fakeFetch({ "https://api.perplexity.ai/": [{ status: 200, body: huge }] });
    const deps = testDeps({ fetch, env: { ...FAKE_KEYS } });
    assert.equal(await main(["--live", "--confirm-spend", "--providers", "perplexity"], deps), 0);
    assert.equal(calls.length, 1);
    const p = JSON.parse(readFileSync(path.join(deps.resultsDir!, "2026-10-18-perplexity.json"), "utf8")) as ResultsFile;
    assert.equal(p.summary.answered, 1);
    assert.match(p.answers[1]!.error ?? "", /past twice its estimate/);
  });
});

describe("rescore and usage", () => {
  it("re-scores a recorded file with no API calls", async () => {
    const { fetch, calls } = fakeFetch(happyRoutes());
    const deps = testDeps({ fetch, env: { ...FAKE_KEYS } });
    assert.equal(await main(["--live", "--confirm-spend", "--questions", "v01", "--providers", "perplexity"], deps), 0);
    const file = path.join(deps.resultsDir!, "2026-10-18-perplexity.json");
    const r = JSON.parse(readFileSync(file, "utf8")) as ResultsFile;
    r.answers[0]!.text = "Nothing about us here.";
    r.answers[0]!.citedUrls = [];
    writeFileSync(file, JSON.stringify(r));
    const sent = calls.length;
    assert.equal(await main(["--rescore", file], deps), 0);
    assert.equal(calls.length, sent);
    const next = JSON.parse(readFileSync(file, "utf8")) as ResultsFile;
    assert.equal(next.summary.named, 0);
    assert.equal(next.summary.cited, 0);
  });

  it("exits 2 on a bad flag or an unknown provider or question", async () => {
    for (const argv of [["--nope"], ["--providers", "bard"], ["--questions", "v99"], ["--questions", ","], ["--date", "tonight"], ["--live", "--rescore", "x.json"]]) {
      const deps = testDeps();
      assert.equal(await main(argv, deps), 2, argv.join(" "));
    }
  });

  it("exits 3 when the inputs will not load", async () => {
    const deps = testDeps({ root: "/nonexistent/ai-visibility" });
    assert.equal(await main([], deps), 3);
  });
});
