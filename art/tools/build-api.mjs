#!/usr/bin/env node
// Writes art/runs/batch-<n>.api.json: every item of a batch as a ComfyUI
// API-format prompt, ready to POST to a self-hosted ComfyUI's /prompt.
//
//   node art/tools/build-api.mjs <n>           write it
//   node art/tools/build-api.mjs <n> --check   exit 1 if it is stale
//
// batch-<n>.json stays the request format (shaped for Comfy Cloud's
// submit_batch). This file is a companion for a runner that is not Comfy Cloud:
// the same words, seed and size, with Comfy's Anima Base v1 subgraph expanded
// into plain core nodes and the turbo switch resolved to off (30 steps, CFG 4,
// euler, simple). Width and height are written into EmptyLatentImage, so the
// runner does not need the newer ResolutionSelector node.
// Exit codes: 0 written or current, 1 stale or invalid sources, 2 usage error.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BRIA, SPACE, build } from "./build-batch.mjs";

const ART = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Model files, from the template's model list (get_template, 2026-10-18).
// Each comes from its own Hugging Face page; see art/workflows/README.md.
export const MODELS = {
  diffusion_models: { file: "anima-base-v1.0.safetensors", page: "https://huggingface.co/circlestone-labs/Anima" },
  text_encoders: { file: "qwen_3_06b_base.safetensors", page: "https://huggingface.co/circlestone-labs/Anima" },
  vae: { file: "qwen_image_vae.safetensors", page: "https://huggingface.co/circlestone-labs/Anima" },
};

// One batch item as an API-format graph. Node ids match the template's interior ids.
export function apiPrompt(item, manifest) {
  const s = item.slot_overrides;
  return {
    "71": { class_type: "CLIPLoader", inputs: { clip_name: MODELS.text_encoders.file, type: "stable_diffusion", device: "default" } },
    "72": { class_type: "VAELoader", inputs: { vae_name: MODELS.vae.file } },
    "78": { class_type: "UNETLoader", inputs: { unet_name: MODELS.diffusion_models.file, weight_dtype: "default" } },
    "74": { class_type: "EmptyLatentImage", inputs: { width: manifest.width, height: manifest.height, batch_size: 1 } },
    "77": { class_type: "CLIPTextEncode", inputs: { text: s["90.text"], clip: ["71", 0] } },
    "75": { class_type: "CLIPTextEncode", inputs: { text: s["90.text_1"], clip: ["71", 0] } },
    "76": {
      class_type: "KSampler",
      inputs: {
        seed: s["90.seed"],
        steps: manifest.steps,
        cfg: manifest.cfg,
        sampler_name: manifest.sampler,
        scheduler: manifest.scheduler,
        denoise: 1,
        model: ["78", 0],
        positive: ["77", 0],
        negative: ["75", 0],
        latent_image: ["74", 0],
      },
    },
    "73": { class_type: "VAEDecode", inputs: { samples: ["76", 0], vae: ["72", 0] } },
    "46": { class_type: "SaveImage", inputs: { filename_prefix: manifest.id, images: ["73", 0] } },
  };
}

// A FIBO 2.0 item as the Bria template's own graph: its one node, then SaveImage.
// It runs only where Comfy's partner nodes run, such as `comfy run --where cloud`.
export function briaApiPrompt(item, manifest) {
  return {
    [BRIA.node]: { class_type: "BriaImageGenerate", inputs: { ...item.input_overrides[BRIA.node] } },
    "2": { class_type: "SaveImage", inputs: { filename_prefix: manifest.id, images: [BRIA.node, 0] } },
  };
}

export function buildApi(n) {
  const req = build(n);
  if (req.template === SPACE.template) throw new Error(`batch ${n} runs on a Hugging Face Space with art/tools/run-space.py; it has no ComfyUI graph`);
  const bria = req.template === BRIA.template;
  const prompts = {};
  req.items.forEach((item, i) => {
    const m = req.manifest[i];
    if (m.id !== item.description) throw new Error(`items and manifest disagree at ${i}`);
    prompts[m.id] = bria ? briaApiPrompt(item, m) : apiPrompt(item, m);
  });
  return {
    _generated: `By art/tools/build-api.mjs from art/runs/batch-${n}.json's sources. Edit the prompts or the plan, then rerun; never edit this file.`,
    batch: req.batch,
    template: req.template,
    note: bria
      ? "Same caption, seed and size as batch-<n>.json. A partner node: run each with `comfy run --workflow <file> --where cloud`, never on a self-hosted ComfyUI. Save each output as <id>.png in the art inbox."
      : "Same words, seed and size as batch-<n>.json. Save each output as <id>.png in the art inbox; ComfyUI names it <id>_00001_.png.",
    models: bria ? {} : MODELS,
    prompts,
  };
}

function main() {
  const args = process.argv.slice(2);
  const n = args.find((a) => /^\d+$/.test(a));
  if (!n) {
    console.error("usage: node art/tools/build-api.mjs <n> [--check]");
    process.exit(2);
  }
  const out = path.join(ART, `runs/batch-${n}.api.json`);
  let next;
  try {
    next = `${JSON.stringify(buildApi(n), null, 2)}\n`;
  } catch (err) {
    console.error(`build-api: ${err.message}`);
    process.exit(1);
  }
  if (args.includes("--check")) {
    const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
    if (current !== next) {
      console.error(`build-api: ${path.relative(process.cwd(), out)} is stale; rerun without --check`);
      process.exit(1);
    }
    console.log(`build-api: batch-${n}.api.json is current`);
    return;
  }
  fs.writeFileSync(out, next);
  console.log(`build-api: wrote ${path.relative(process.cwd(), out)} (${Object.keys(JSON.parse(next).prompts).length} prompts)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
