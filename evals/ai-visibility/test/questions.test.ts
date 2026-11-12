// The question set and the docs that describe it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { parse } from "yaml";

import { estimate, parsePricing, PROVIDER_IDS, usd } from "../cost.ts";
import { parseQuestions, REGIONS, TOPICS } from "../panel.ts";
import { ROOT } from "./helpers.ts";

const questions = parseQuestions(parse(readFileSync(path.join(ROOT, "questions.yaml"), "utf8")));

describe("questions.yaml", () => {
  it("holds the 20-question panel with stable ids", () => {
    assert.equal(questions.length, 20);
    assert.deepEqual(
      questions.map((q) => q.id),
      Array.from({ length: 20 }, (_, i) => `v${String(i + 1).padStart(2, "0")}`),
    );
  });

  it("covers every topic and every region", () => {
    for (const t of TOPICS) assert.ok(questions.some((q) => q.topic === t), `no ${t} question`);
    for (const r of REGIONS) assert.ok(questions.some((q) => q.region === r), `no ${r} question`);
  });

  it("rejects a question that names us or says Colorado startups", () => {
    const base = { id: "v01", topic: "community", region: "statewide" };
    assert.throws(() => parseQuestions([{ ...base, question: "Is Colorado Startups any good?" }]), /names Colorado Startups/);
    assert.throws(() => parseQuestions([{ ...base, question: "Where do colorado startups meet?" }]), /names Colorado Startups/);
    assert.throws(() => parseQuestions([{ ...base, question: "What is on coloradostartups.org?" }]), /names Colorado Startups/);
    assert.throws(() => parseQuestions([{ ...base, question: "A fine question here?" }, { ...base, question: "A second question here?" }]), /duplicate/);
  });
});

describe("REPORT.md", () => {
  const report = readFileSync(path.join(ROOT, "REPORT.md"), "utf8");

  it("keeps the results markers the runner rewrites", () => {
    assert.ok(report.includes("<!-- results:start -->") && report.includes("<!-- results:end -->"));
  });

  it("states the same estimate the runner prints from pricing.yaml", () => {
    const pricing = parsePricing(parse(readFileSync(path.join(ROOT, "pricing.yaml"), "utf8")));
    const total = estimate(pricing, PROVIDER_IDS, questions.length).reduce((n, e) => n + e.total, 0);
    assert.ok(report.includes(`estimates ${usd(total)}`), `REPORT.md should say "estimates ${usd(total)}"`);
  });

  it("has no em dash and no spaced en dash", () => {
    assert.ok(!/\u2014| \u2013 /.test(report));
  });
});
