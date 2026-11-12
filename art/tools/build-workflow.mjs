#!/usr/bin/env node
// Writes the open workflow for publication: Comfy's official Anima Base v1
// template graph with the Hall's style, size and seed applied.
//
//   node art/tools/build-workflow.mjs [--batch <n>] [--id <item>] [--check]
//
// Base:   art/workflows/base/image_anima_base_v1.json (the template graph as read
//         with get_template on 2026-10-18; see art/workflows/README.md)
// Words:  the composed prompt of one item from art/runs/batch-<n>.json, so the
//         published workflow carries exactly what ran
// Output: art/workflows/anima-forge-kingdom-t2i.json
// --check exits 1 when the output is stale. Exit 2 on a usage error.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "./build-batch.mjs";

const ART = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = path.join(ART, "workflows/base/image_anima_base_v1.json");
const OUT = path.join(ART, "workflows/anima-forge-kingdom-t2i.json");

const NODE = { note: 48, save: 46, size: 91, positive: 77, negative: 75, sampler: 76 };

function usage(msg) {
  console.error(`build-workflow: ${msg}\nusage: node art/tools/build-workflow.mjs [--batch <n>] [--id <item>] [--check]`);
  process.exit(2);
}

function arg(args, name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  if (!args[i + 1]) usage(`${name} needs a value`);
  return args[i + 1];
}

function note({ batch, id, size }) {
  return [
    "## Colorado Startups: the forge-kingdom look",
    "",
    "Text to image with **Anima Base v1**, built on Comfy's official template `image_anima_base_v1`.",
    "This copy carries the style line, quality prefix, negative prompt, size and seed used for the coloradostartups.org art.",
    `Prompt and seed: item \`${id}\` of batch ${batch}. Size: Resolution Selector set to ${size.aspect_ratio}, ${size.megapixels} MP, multiple ${size.multiple}.`,
    "",
    "## Models (download each from its own page; no weights are bundled)",
    "",
    "- Anima Base v1, text encoder and VAE: [circlestone-labs/Anima](https://huggingface.co/circlestone-labs/Anima)",
    "- Turbo LoRA (off by default): [circlestone-labs/Anima-Official-LoRAs](https://huggingface.co/circlestone-labs/Anima-Official-LoRAs)",
    "",
    "Read each model's license on its page before you use it.",
    "",
    "## Settings",
    "",
    "- Steps 30, CFG 4, euler sampler, simple scheduler (inside the subgraph)",
    "- Size comes from the Resolution Selector, which feeds the subgraph's width and height",
    "- Prompts are plain descriptions: no artist, character, franchise or site tags",
  ].join("\n");
}

function findNode(nodes, id) {
  const n = nodes.find((x) => x.id === id);
  if (!n) throw new Error(`base workflow has no node ${id}`);
  return n;
}

export function buildWorkflow(batch, id) {
  const req = build(batch);
  const i = req.items.findIndex((it) => it.description === id);
  if (i === -1) throw new Error(`batch ${batch} has no item "${id}"`);
  const item = req.items[i];
  const size = item.input_overrides["91"];
  const wf = JSON.parse(fs.readFileSync(BASE, "utf8"));
  const inner = wf.definitions.subgraphs[0].nodes;

  findNode(wf.nodes, NODE.note).widgets_values = [note({ batch, id, size })];
  findNode(wf.nodes, NODE.save).widgets_values = ["cs-forge-kingdom"];
  findNode(wf.nodes, NODE.size).widgets_values = [size.aspect_ratio, size.megapixels, size.multiple];
  findNode(inner, NODE.positive).widgets_values = [item.slot_overrides["90.text"]];
  findNode(inner, NODE.negative).widgets_values = [item.slot_overrides["90.text_1"]];
  const sampler = findNode(inner, NODE.sampler);
  sampler.widgets_values = [item.slot_overrides["90.seed"], "fixed", ...sampler.widgets_values.slice(2)];
  return `${JSON.stringify(wf, null, 2)}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const batch = arg(args, "--batch", "1");
  const id = arg(args, "--id", "hero-a");
  if (!/^\d+$/.test(batch)) usage("--batch must be a number");
  let next;
  try {
    next = buildWorkflow(batch, id);
  } catch (err) {
    console.error(`build-workflow: ${err.message}`);
    process.exit(1);
  }
  if (args.includes("--check")) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (current !== next) {
      console.error(`build-workflow: ${path.relative(process.cwd(), OUT)} is stale; rerun without --check`);
      process.exit(1);
    }
    console.log("build-workflow: workflow is current");
    return;
  }
  fs.writeFileSync(OUT, next);
  console.log(`build-workflow: wrote ${path.relative(process.cwd(), OUT)} from batch ${batch}, item ${id}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
