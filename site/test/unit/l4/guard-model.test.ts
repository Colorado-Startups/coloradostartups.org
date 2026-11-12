import { describe, expect, it } from "vitest";

import { GUARD_MODEL, isBlocking, LlamaGuard, parseGuardVerdict } from "../../../worker/resourcus/guard";
import {
  CANDIDATE_MODELS,
  extractText,
  modelInputs,
  RESOURCUS_MODEL,
  WorkersAiModel,
} from "../../../worker/resourcus/model";

describe("parseGuardVerdict", () => {
  it.each([
    [{ response: { safe: true } }, { safe: true, categories: [] }],
    [{ response: { safe: true, categories: [] } }, { safe: true, categories: [] }],
    [{ response: { safe: false, categories: ["S1", "S10"] } }, { safe: false, categories: ["S1", "S10"] }],
    [{ response: "safe" }, { safe: true, categories: [] }],
    [{ response: "unsafe\nS13" }, { safe: false, categories: ["S13"] }],
    [{ response: " unsafe\nS2,S7 " }, { safe: false, categories: ["S2", "S7"] }],
    ["safe", { safe: true, categories: [] }],
    [" SAFE \n", { safe: true, categories: [] }],
    ["unsafe", { safe: false, categories: [] }],
    ["UNSAFE\r\nS1,S10", { safe: false, categories: ["S1", "S10"] }],
  ])("reads %j", (input, expected) => {
    expect(parseGuardVerdict(input)).toEqual(expected);
  });

  // #734: only an exact "safe" is safe; anything else fails closed.
  it.each([
    [{}],
    [{ response: { categories: [] } }],
    [{ response: "maybe" }],
    [null],
    [42],
    ["safely"],
    ["SAFE\nS1"],
    ["safe extra"],
    [""],
    [{ response: "" }],
    ["unsafely"],
    ["unsafe S3"],
    // #745: safe with any category, S-code or not, is not a clean verdict.
    [{ response: { safe: true, categories: ["S1"] } }],
    [{ response: { safe: true, categories: ["s10", "S2"] } }],
    [{ response: { safe: true, categories: ["violent_crimes"] } }],
    [{ response: { safe: true, categories: [7, null] } }],
  ])(
    "returns null for unreadable %j",
    (input) => {
      expect(parseGuardVerdict(input)).toBeNull();
    },
  );
});

describe("isBlocking", () => {
  it("lets safe input through", () => expect(isBlocking({ safe: true, categories: [] })).toBe(false));
  it("does not block on S6 (specialized advice) alone", () =>
    expect(isBlocking({ safe: false, categories: ["S6"] })).toBe(false));
  it("blocks S6 with anything else", () => expect(isBlocking({ safe: false, categories: ["S6", "S2"] })).toBe(true));
  it("blocks elections (S13)", () => expect(isBlocking({ safe: false, categories: ["S13"] })).toBe(true));
  it("blocks unsafe with no category", () => expect(isBlocking({ safe: false, categories: [] })).toBe(true));
});

describe("LlamaGuard", () => {
  it("calls Llama Guard 3 and throws on an unreadable verdict", async () => {
    const calls: string[] = [];
    const guard = new LlamaGuard({
      run: async (model) => {
        calls.push(model);
        return { response: "no idea" };
      },
    });
    await expect(guard.check("hello")).rejects.toThrow(/unreadable/);
    expect(calls).toEqual([GUARD_MODEL]);
  });
});

describe("extractText", () => {
  it.each([
    [{ choices: [{ message: { content: "Chat answer." } }] }, "Chat answer."],
    [{ choices: [{ message: { content: "<think>hmm</think>Qwen answer." } }] }, "Qwen answer."],
    [{ choices: [{ message: { content: null, reasoning_content: "secret plan" } }] }, ""],
    [{ output_text: "Responses answer." }, "Responses answer."],
    [
      {
        output: [
          { type: "reasoning", content: [{ type: "reasoning_text", text: "plan" }] },
          { type: "message", content: [{ type: "output_text", text: "From output." }] },
        ],
      },
      "From output.",
    ],
    [{ response: "Legacy answer." }, "Legacy answer."],
    ["Plain string.", "Plain string."],
    [undefined, ""],
  ])("reads %j", (input, expected) => {
    expect(extractText(input)).toBe(expected);
  });
});

describe("model choice and inputs", () => {
  it("compares exactly the three planned models and defaults to Qwen3 30B (live eval pick)", () => {
    expect([...CANDIDATE_MODELS]).toEqual([
      "@cf/zai-org/glm-4.7-flash",
      "@cf/qwen/qwen3-30b-a3b-fp8",
      "@cf/openai/gpt-oss-20b",
    ]);
    expect(RESOURCUS_MODEL).toBe("@cf/qwen/qwen3-30b-a3b-fp8");
  });

  const msgs = [
    { role: "system" as const, content: "rules" },
    { role: "user" as const, content: "q" },
  ];

  it("turns reasoning down per model", () => {
    expect(modelInputs("@cf/zai-org/glm-4.7-flash", msgs)).toMatchObject({
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(modelInputs("@cf/openai/gpt-oss-20b", msgs)).toMatchObject({ reasoning_effort: "low" });
    const qwen = modelInputs("@cf/qwen/qwen3-30b-a3b-fp8", msgs) as { messages: { content: string }[] };
    expect(qwen.messages[0]!.content.endsWith("/no_think")).toBe(true);
    expect(qwen.messages[1]!.content).toBe("q");
  });

  it("caps output tokens and passes no tools", () => {
    for (const m of CANDIDATE_MODELS) {
      const inputs = modelInputs(m, msgs);
      expect(inputs.max_tokens).toBe(400);
      expect(inputs).not.toHaveProperty("tools");
      expect(inputs).not.toHaveProperty("functions");
    }
  });

  it("WorkersAiModel sends the shaped inputs to the chosen model", async () => {
    const seen: { model: string; inputs: Record<string, unknown> }[] = [];
    const model = new WorkersAiModel({
      run: async (m, inputs) => {
        seen.push({ model: m, inputs });
        return { choices: [{ message: { content: "ok" } }] };
      },
    });
    expect(await model.generate(msgs)).toBe("ok");
    expect(seen[0]!.model).toBe(RESOURCUS_MODEL);
  });
});
