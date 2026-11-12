// L6: FIBO 2.0 batches on Comfy Cloud's Bria node (art/tools/build-batch.mjs,
// build-api.mjs) and make-finals' one-batch mode.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { buildApi } from "../../../../art/tools/build-api.mjs";
import { BRIA, SPACE, VGL_OWN, briaModeration, build, parseVglFile, spaceModeration, vglCaption } from "../../../../art/tools/build-batch.mjs";
import { batchPlan, checkFinal } from "../../../../art/tools/make-finals.mjs";
import { PROMPT_READERS, setWebpXmp } from "../../../../art/tools/provenance.mjs";

const ROOT = path.join(__dirname, "../../../..");
const MAKE_FINALS = path.join(ROOT, "art/tools/make-finals.mjs");
const RUN_SPACE = path.join(ROOT, "art/tools/run-space.py");
const plan = JSON.parse(readFileSync(path.join(ROOT, "art/finals.json"), "utf8"));
const fixed = JSON.parse(readFileSync(path.join(ROOT, "art/prompts/vgl-style.txt"), "utf8"));

const own = {
  short_description: "A passage. It ends at a wall.",
  objects: [{ description: "a wall", location: "center", relationship: "the end" }],
  background_setting: "a hall",
  lighting_direction: "from both walls",
  composition: "centered",
  context: "a 404 page",
};
const file = (body: object) => `title: A test\n\n${JSON.stringify(body)}`;

describe("VGL prompt files", () => {
  it("reads a title and the still's own fields", () => {
    expect(parseVglFile(file(own), "t.txt")).toEqual(own);
  });

  it("refuses a missing field, an unknown one, too many objects and a body that is not JSON", () => {
    const { context: _drop, ...noContext } = own;
    expect(() => parseVglFile(file(noContext), "t.txt")).toThrow(/missing context/);
    expect(() => parseVglFile(file({ ...own, text_render: [] }), "t.txt")).toThrow(/unknown text_render/);
    expect(() => parseVglFile(file({ ...own, objects: Array(6).fill(own.objects[0]) }), "t.txt")).toThrow(/1 to 5/);
    expect(() => parseVglFile("title: A test\n\nnot json", "t.txt")).toThrow(/not JSON/);
    expect(() => parseVglFile(`use: x\n\n${JSON.stringify(own)}`, "t.txt")).toThrow(/title/);
  });

  it("puts the shared words from vgl-style.txt into every caption, in the guide's order", () => {
    const caption = vglCaption(own, fixed);
    expect(Object.keys(caption)).toEqual(["short_description", "objects", "background_setting", "lighting", "aesthetics", "style_medium", "context", "artistic_style"]);
    expect(caption.lighting).toEqual({ conditions: fixed.lighting_conditions, direction: own.lighting_direction, shadows: fixed.lighting_shadows });
    expect(caption.aesthetics.color_scheme).toBe(fixed.color_scheme);
    expect(caption.style_medium).toBe(fixed.style_medium);
  });
});

describe("batch 3", () => {
  const req = build("3");

  it("batch-3.json equals build('3'), and batch-3.api.json equals buildApi('3')", () => {
    expect(JSON.parse(readFileSync(path.join(ROOT, "art/runs/batch-3.json"), "utf8"))).toEqual(req);
    expect(JSON.parse(readFileSync(path.join(ROOT, "art/runs/batch-3.api.json"), "utf8"))).toEqual(buildApi("3"));
  });

  it("sends each still a whole caption with no text field, a seed in the node's range and a 16:9 size", () => {
    for (const item of req.items) {
      const node = item.input_overrides[BRIA.node];
      const caption = JSON.parse(node.structured_prompt);
      expect(Object.keys(caption), item.description).not.toContain("text_render");
      for (const k of VGL_OWN.filter((f) => !["lighting_direction", "composition"].includes(f))) expect(caption[k], `${item.description} ${k}`).toBeTruthy();
      expect(node.seed).toBeGreaterThanOrEqual(1);
      expect(node.seed).toBeLessThanOrEqual(BRIA.maxSeed);
      // Batch 3 ran with Bria's filter off, and its plan records that.
      expect([node.aspect_ratio, node.prompt, node.moderation]).toEqual(["16:9", "", "false"]);
    }
  });

  it("gives every API graph the Bria node and a SaveImage named for the still", () => {
    const api = buildApi("3");
    for (const [id, graph] of Object.entries(api.prompts) as [string, Record<string, { class_type: string; inputs: Record<string, unknown> }>][]) {
      expect(graph[BRIA.node].class_type).toBe("BriaImageGenerate");
      expect(graph["2"].inputs.filename_prefix).toBe(id);
    }
  });
});

describe("batch 4, on Bria's Hugging Face Space", () => {
  const req = build("4");

  it("batch-4.json equals build('4'), and it has no ComfyUI graph", () => {
    expect(JSON.parse(readFileSync(path.join(ROOT, "art/runs/batch-4.json"), "utf8"))).toEqual(req);
    expect(() => buildApi("4")).toThrow(/run-space.py/);
  });

  it("sends each still to the Space's endpoint with its caption, its own seed and the widest size", () => {
    for (const item of req.items) {
      expect([item.tool, item.space, item.api_name]).toEqual(["gradio", SPACE.space, SPACE.api]);
      expect(JSON.parse(item.inputs.json_prompt).style_medium).toBe(fixed.style_medium);
      expect(item.inputs).toMatchObject({ prompt: "", randomize: false, width: 1344, height: 768, steps: 50 });
      expect(PROMPT_READERS[SPACE.template](item)).toEqual({ prompt: item.inputs.json_prompt, seed: item.inputs.seed });
    }
  });

  it("batch-5.json equals build('5'), with the same unfiltered record", () => {
    const five = build("5");
    expect(JSON.parse(readFileSync(path.join(ROOT, "art/runs/batch-5.json"), "utf8"))).toEqual(five);
    expect(five).toMatchObject({ template: SPACE.template, moderation: "none", inbox: "art/inbox/batch-5/" });
  });

  it("records that the Space runs unfiltered, and why, and lands its renders in the ignored art/inbox", () => {
    expect(req).toMatchObject({ moderation: "none", inbox: "art/inbox/batch-4/" });
    expect(req.moderation_why).toMatch(/no moderation input/);
  });

  it("refuses a Space plan that does not say how moderation applies", () => {
    expect(() => spaceModeration({})).toThrow(/must set moderation "none"/);
    expect(() => spaceModeration({ moderation: "true" })).toThrow(/no content filter/);
    expect(() => spaceModeration({ moderation: "none", moderation_why: " " })).toThrow(/moderation_why/);
  });
});

describe("run-space.py refuses before it loads a client", () => {
  const INBOX = path.join(ROOT, "art/inbox");
  const py = (args: string[]) => spawnSync("python3", ["-I", RUN_SPACE, ...args], { encoding: "utf8" });
  // A request file with one item changed, for the refusals that need a bad batch.
  const withItem = (change: Record<string, unknown>) => {
    const dir = mkdtempSync(path.join(tmpdir(), "l6-"));
    const req = build("4");
    req.items = [{ ...req.items[0], ...change }];
    const file = path.join(dir, "request.json");
    writeFileSync(file, JSON.stringify(req));
    return { file, done: () => rmSync(dir, { recursive: true, force: true }) };
  };

  it("exits 2 on a batch that is not a Space batch, an unknown item, or an inbox outside art/inbox", () => {
    expect(py(["3", "--inbox", INBOX]).status).toBe(2);
    expect(py(["4", "--inbox", INBOX, "--only", "scene-nope"]).status).toBe(2);
    const outside = py(["4", "--inbox", path.join(ROOT, "art")]);
    expect(outside.status).toBe(2);
    expect(outside.stderr).toMatch(/inside art\/inbox/);
  });

  it("exits 2 on another Space without --allow-space, another endpoint, or a name that is not a slug", () => {
    for (const [change, message] of [
      [{ space: "someone/other-space" }, /pass --allow-space/],
      [{ api_name: "/other" }, /is not \/generate_image/],
      [{ description: "../../etc/x" }, /is not a slug/],
      [{ description: "a/b" }, /is not a slug/],
    ] as [Record<string, unknown>, RegExp][]) {
      const req = withItem(change);
      try {
        const r = py(["4", "--inbox", INBOX, "--request", req.file]);
        expect(r.status, JSON.stringify(change)).toBe(2);
        expect(r.stderr).toMatch(message);
      } finally {
        req.done();
      }
    }
  });
});

describe("Bria's content filter", () => {
  it("is on for prompts and outputs unless the plan says false, and refuses any other value", () => {
    expect(briaModeration({})).toEqual({
      moderation: "true",
      "moderation.prompt_content_moderation": true,
      "moderation.visual_input_moderation": false,
      "moderation.visual_output_moderation": true,
    });
    expect(briaModeration({ moderation: "false" })).toEqual({ moderation: "false" });
    expect(() => briaModeration({ moderation: "off" })).toThrow(/"true" or "false"/);
  });
});

describe("scene weight", () => {
  it("flags a scene over the 400 KB limit", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "l6-"));
    try {
      let seed = 7;
      const noise = Buffer.alloc(1344 * 756 * 3).map(() => ((seed = (seed * 16807) % 2147483647) % 256));
      const file = path.join(dir, "heavy.webp");
      const webp = await sharp(noise, { raw: { width: 1344, height: 756, channels: 3 } }).webp({ quality: 100 }).toBuffer();
      writeFileSync(file, setWebpXmp(webp, "<x/>"));
      expect((await checkFinal(file, "scene", "<x/>")).problems.join()).toMatch(/over the 400 KB limit/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("make-finals one batch", () => {
  it("keeps only that batch's finals and tiles", () => {
    const two = batchPlan(plan, 2);
    expect(two.finals.map((e: { out: string }) => e.out)).toEqual(["regions/fusion-canyon"]);
    expect(Object.keys(two.tiles).filter((k) => !k.startsWith("_")).sort()).toEqual(["parchment", "stone"]);
  });

  it("exits 2 on a batch that ships nothing, a bad number, or --batch with --stamp", () => {
    const run = (args: string[]) => spawnSync(process.execPath, [MAKE_FINALS, ...args], { encoding: "utf8" });
    expect(run(["--from", ROOT, "--batch", "99"]).status).toBe(2);
    expect(run(["--from", ROOT, "--batch", "x"]).status).toBe(2);
    expect(run(["--stamp", "--batch", "3"]).status).toBe(2);
  });
});
