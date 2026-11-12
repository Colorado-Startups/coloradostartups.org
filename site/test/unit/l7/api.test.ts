// L7: the API-format companion to the batch file (art/tools/build-api.mjs) must
// run the same graph as Comfy's Anima Base v1 template with turbo off.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { IN_ARCHIVE } from "../../archive";

import { buildApi } from "../../../../art/tools/build-api.mjs";
import { build } from "../../../../art/tools/build-batch.mjs";
import { buildWorkflow } from "../../../../art/tools/build-workflow.mjs";

const ROOT = path.join(__dirname, "../../../..");
// art/workflows and art/runs are private: the public export leaves them out,
// so both suites below skip there and these reads wait for the archive.
type Node = { id: number; type: string; widgets_values: unknown[] };
const base = IN_ARCHIVE ? JSON.parse(readFileSync(path.join(ROOT, "art/workflows/base/image_anima_base_v1.json"), "utf8")) : { definitions: { subgraphs: [{ nodes: [] }] } };
const inner = new Map<number, Node>(base.definitions.subgraphs[0].nodes.map((n: Node) => [n.id, n]));
const api = (IN_ARCHIVE ? buildApi("1") : {}) as ReturnType<typeof buildApi>;
const req = (IN_ARCHIVE ? build("1") : {}) as ReturnType<typeof build>;

// Generated files are pinned: what is on disk must be what the builders write.
describe.skipIf(!IN_ARCHIVE)("generated files", () => {
  it("batch-1.json equals build('1')", () => {
    const onDisk = readFileSync(path.join(ROOT, "art/runs/batch-1.json"), "utf8");
    expect(JSON.parse(onDisk)).toEqual(req);
  });

  it("the published workflow equals buildWorkflow('1', 'hero-a')", () => {
    const onDisk = readFileSync(path.join(ROOT, "art/workflows/anima-forge-kingdom-t2i.json"), "utf8");
    expect(onDisk).toBe(buildWorkflow("1", "hero-a"));
  });
});

describe.skipIf(!IN_ARCHIVE)("batch-1.api.json", () => {
  it("is current with its sources", () => {
    const onDisk = JSON.parse(readFileSync(path.join(ROOT, "art/runs/batch-1.api.json"), "utf8"));
    expect(onDisk).toEqual(api);
  });

  it("has one prompt per batch item, under the same ids", () => {
    expect(Object.keys(api.prompts)).toEqual(req.manifest.map((m: { id: string }) => m.id));
  });

  it("uses the template's node types and model files", () => {
    const p = api.prompts["hero-a"];
    for (const id of ["71", "72", "73", "74", "75", "76", "77", "78"]) {
      expect(p[id].class_type, id).toBe(inner.get(Number(id))?.type);
    }
    expect(p["71"].inputs.clip_name).toBe(inner.get(71)?.widgets_values[0]);
    expect(p["71"].inputs.type).toBe(inner.get(71)?.widgets_values[1]);
    expect(p["72"].inputs.vae_name).toBe(inner.get(72)?.widgets_values[0]);
    expect(p["78"].inputs.unet_name).toBe(inner.get(78)?.widgets_values[0]);
  });

  it("resolves the turbo switch to off: the full-model steps and CFG", () => {
    const k = api.prompts["hero-a"]["76"].inputs;
    expect(k.steps).toBe(inner.get(79)?.widgets_values[0]); // Int (Steps), full
    expect(k.cfg).toBe(inner.get(86)?.widgets_values[0]); // Float (CFG), full
    expect(k.sampler_name).toBe(inner.get(76)?.widgets_values[4]);
    expect(k.scheduler).toBe(inner.get(76)?.widgets_values[5]);
    expect(k.model).toEqual(["78", 0]);
  });

  it("carries each item's words, seed and size", () => {
    req.items.forEach((item: { description: string; slot_overrides: Record<string, unknown> }, i: number) => {
      const p = api.prompts[item.description];
      expect(p["77"].inputs.text).toBe(item.slot_overrides["90.text"]);
      expect(p["75"].inputs.text).toBe(item.slot_overrides["90.text_1"]);
      expect(p["76"].inputs.seed).toBe(item.slot_overrides["90.seed"]);
      expect([p["74"].inputs.width, p["74"].inputs.height]).toEqual([req.manifest[i].width, req.manifest[i].height]);
      expect(p["46"].inputs.filename_prefix).toBe(item.description);
    });
  });
});
