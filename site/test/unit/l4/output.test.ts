import { describe, expect, it } from "vitest";

import {
  capLength,
  containsLeak,
  enforceVoice,
  extractCitations,
  neutralizeMentions,
  sanitizeAnswer,
  stripLinks,
  stripReasoning,
} from "../../../worker/resourcus/output";
import { LEAK_MARKERS, SYSTEM_PROMPT } from "../../../worker/resourcus/prompt";

// Built from code points so this file holds no literal dash characters.
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

describe("extractCitations", () => {
  const retrieved = new Set(["fx-headframe-accelerator", "fx-ore-cart-coworking"]);

  it("keeps retrieved ids in order and drops the rest", () => {
    const out = extractCitations(
      "Try Ore Cart Coworking [fx-ore-cart-coworking] and Headframe [fx-headframe-accelerator]. Also [made-up-place].",
      retrieved,
    );
    expect(out.cited).toEqual(["fx-ore-cart-coworking", "fx-headframe-accelerator"]);
    expect(out.dropped).toEqual(["made-up-place"]);
    expect(out.text).toBe("Try Ore Cart Coworking  and Headframe . Also .");
  });

  it("reads several ids in one bracket and dedupes", () => {
    const out = extractCitations("Both [fx-ore-cart-coworking, fx-headframe-accelerator] [fx-ore-cart-coworking]", retrieved);
    expect(out.cited).toEqual(["fx-ore-cart-coworking", "fx-headframe-accelerator"]);
  });

  it("leaves markdown links for the link stripper", () => {
    const out = extractCitations("[fx-ore-cart-coworking](https://evil.example)", retrieved);
    expect(out.cited).toEqual([]);
    expect(out.text).toContain("](https://evil.example)");
  });
});

describe("stripLinks", () => {
  it.each([
    ["Visit https://evil.example/path?x=1 now", "Visit  now"],
    ["Visit http://evil.example now", "Visit  now"],
    ["Go to www.evil.example today", "Go to  today"],
    ["See evil-site.com/signup for more", "See  for more"],
    ["Mail ceo@evil.example please", "Mail  please"],
    ["Call (303) 555-0100 now", "Call  now"],
    ["Click javascript:alert(1) here", "Click  here"],
    ["Read [the guide](https://evil.example) first", "Read the guide first"],
    ["![x](https://evil.example/pixel.png)", "x"],
  ])("removes %j", (input, expected) => {
    expect(stripLinks(input)).toBe(expected);
  });

  it("leaves ordinary words alone", () => {
    expect(stripLinks("Headframe Accelerator runs a demo day in Boulder.")).toBe(
      "Headframe Accelerator runs a demo day in Boulder.",
    );
  });
});

describe("neutralizeMentions", () => {
  it.each([
    ["Hey <!channel> look", "Hey  look"],
    ["<!here> now", " now"],
    ["<!everyone> hi", " hi"],
    ["ping <@U012ABCDEF>", "ping "],
    ["see <#C012345|general>", "see "],
    ["<https://evil.example|click me>", ""],
    ["<script>alert(1)</script>", "alert(1)"],
    ["<img src=x onerror=alert(1)>", ""],
    ["hello @channel and @here and @everyone", "hello  and  and "],
    ["thanks @Ann", "thanks Ann"],
  ])("neutralizes %j", (input, expected) => {
    expect(neutralizeMentions(input)).toBe(expected);
  });
});

describe("enforceVoice", () => {
  it("turns em and en dashes into commas", () => {
    expect(enforceVoice(`Two programs ${EM} both in Denver ${EN} fit.`)).toBe("Two programs, both in Denver, fit.");
  });

  it("strips markdown", () => {
    expect(enforceVoice("## Picks\n- **Ore Cart** is `great`\n> quote")).toBe("Picks\nOre Cart is great\nquote");
  });

  it("removes zero-width characters", () => {
    expect(enforceVoice(`a${String.fromCharCode(0x200b)}b`)).toBe("ab");
  });
});

describe("leaks and reasoning", () => {
  it("flags every leak marker, case-insensitively", () => {
    for (const m of LEAK_MARKERS) expect(containsLeak(`sure: ${m.toLowerCase()} ...`)).toBe(true);
    expect(containsLeak("Ore Cart Coworking has desks in Denver.")).toBe(false);
  });

  it("every leak marker really is in the system prompt or the record block", () => {
    const markersInPrompt = LEAK_MARKERS.filter((m) => SYSTEM_PROMPT.includes(m));
    expect(markersInPrompt.length).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ["markdown inside the heading", "RESOURCUS **HOUSE** RULES"],
    ["code ticks inside the canary", "hall-`ledger`-4417"],
    ["non-breaking hyphens in the canary", `hall${String.fromCharCode(0x2011)}ledger${String.fromCharCode(0x2011)}4417`],
    ["a non-breaking space", `BEGIN${String.fromCharCode(0x00a0)}CANVAS RECORDS`],
    ["a zero-width split", `END CAN${String.fromCharCode(0x200b)}VAS RECORDS`],
  ])("catches a marker hidden by %s, before and after cleanup", (_name, text) => {
    expect(containsLeak(text)).toBe(true);
    expect(containsLeak(sanitizeAnswer(text))).toBe(true);
  });

  it("drops <think> blocks, closed or open", () => {
    expect(stripReasoning("<think>plan</think>Answer.")).toBe("Answer.");
    expect(stripReasoning("Answer.<think>never closed")).toBe("Answer.");
    expect(stripReasoning("leftover reasoning</think>Answer.")).toBe("Answer.");
  });
});

describe("sanitizeAnswer", () => {
  it("cleans a hostile answer down to plain text", () => {
    const hostile = `<!channel> **Apply** at https://evil.example ${EM} or email a@b.co. <img src=x onerror=alert(1)>`;
    const out = sanitizeAnswer(hostile);
    expect(out).toBe("Apply at, or email.");
    expect(out).not.toMatch(/https?:|<|>|@/);
  });

  it("caps long answers at a sentence end, and never past the cap", () => {
    const long = "Short sentence here. ".repeat(100);
    const out = capLength(long, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith(".")).toBe(true);
    expect(capLength("x".repeat(500), 200).length).toBeLessThanOrEqual(200);
  });
});
