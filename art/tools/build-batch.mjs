#!/usr/bin/env node
// Builds a Comfy Cloud run request for the orchestrator from the prompt sources.
//
//   node art/tools/build-batch.mjs <n>           write art/runs/batch-<n>.json
//   node art/tools/build-batch.mjs <n> --check   exit 1 if that file is stale
//
// Sources: art/runs/batch-<n>.plan.json (which images), art/prompts/*.txt (the
// words) and art/prompts/sizes.json (node 91 settings per kind). The prompt
// files are .txt so the content gate scans them; the generated JSON is not
// scanned, which is why it is generated and never edited by hand.
//
// The output's `items` array is shaped for the Comfy Cloud `submit_batch` tool
// as-is: prompts in `slot_overrides`, size on node 91 in `input_overrides`.
// `manifest` carries the same images in the same order with the settings a
// person reads: output file, size, seed, steps.
//
// A plan whose template is api_bria_fibo2_t2i (FIBO 2.0 on the Bria node)
// builds differently: each prompt file holds the still's part of a VGL
// caption, art/prompts/vgl-style.txt the shared words, and the whole caption,
// seed and size go to node 1 in `input_overrides`. A plan whose template is
// hf_space_fibo2_t2i builds the same captions as `gradio` items for Bria's
// Hugging Face Space, which art/tools/run-space.py runs.
//
// Exit codes follow the repo's checker contract: 0 clean, 1 stale or invalid
// sources, 2 usage error.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ART = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROMPTS = path.join(ART, "prompts");
const RUNS = path.join(ART, "runs");

// Fixed inside the template's subgraph (read from get_template on 2026-10-18).
const TEMPLATE_FIXED = { steps: 30, cfg: 4, sampler: "euler", scheduler: "simple", turbo: false };
const SLOT = { prompt: "90.text", negative: "90.text_1", seed: "90.seed" };
const SIZE_NODE = "91";
const MAX_ITEMS = 50; // submit_batch accepts 1 to 50 items per call

function usage(msg) {
  console.error(`build-batch: ${msg}\nusage: node art/tools/build-batch.mjs <n> [--check]`);
  process.exit(2);
}

function readText(name) {
  return fs.readFileSync(path.join(PROMPTS, name), "utf8").trim();
}

// A prompt file is `key: value` header lines, a blank line, then the body.
export function parsePromptFile(text, name) {
  const [head, ...rest] = text.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  const body = rest.join("\n\n").trim();
  const meta = {};
  for (const line of head.split("\n")) {
    const m = line.match(/^([a-z]+):\s*(.*)$/);
    if (!m) throw new Error(`${name}: header line is not "key: value": ${line}`);
    meta[m[1]] = m[2].trim();
  }
  for (const key of ["title", "framing"]) {
    if (!meta[key]) throw new Error(`${name}: missing "${key}:" header`);
  }
  if (!body) throw new Error(`${name}: empty body`);
  // Anima's model card asks for at least two descriptive sentences.
  if ((body.match(/[.!?](\s|$)/g) || []).length < 2) throw new Error(`${name}: body needs two or more sentences`);
  return { ...meta, body };
}

// House writing rule: no em dashes and no spaced en dashes, in prompts too.
function checkDashes(text, where) {
  if (/—|\s–\s/.test(text)) throw new Error(`${where}: em dash or spaced en dash`);
}

// No dataset or site tag opens the prompt (orchestrator ruling, 2026-10-18): the
// published workflow goes public, so the look rests on plain words alone.
export function composePrompt({ file, quality, style, tail }) {
  return [quality, file.body, style, [file.framing, tail].filter(Boolean).join(" ")].join("\n");
}

// FIBO 2.0 through Comfy Cloud's Bria node: template api_bria_fibo2_t2i, whose
// one BriaImageGenerate node is node 1 (get_template_schema, 2026-11-03).
export const BRIA = { template: "api_bria_fibo2_t2i", node: "1", maxSeed: 2147483647 };

// FIBO 2.0 Dev on Bria's own ZeroGPU Space, free on the caller's Hugging Face
// quota. art/tools/run-space.py sends each item to its /generate_image endpoint
// (view_api, 2026-11-03), which takes the caption as json_prompt.
export const SPACE = { template: "hf_space_fibo2_t2i", space: "briaai/Fibo-2.0-T2I", api: "/generate_image" };

// The fields a still's own prompt file gives; vgl-style.txt gives the rest,
// the words every still shares (art/direction/fibo-prompts.md).
export const VGL_OWN = ["short_description", "objects", "background_setting", "lighting_direction", "composition", "context"];
const VGL_FIXED = ["lighting_conditions", "lighting_shadows", "color_scheme", "mood_atmosphere", "style_medium", "artistic_style"];

// A VGL prompt file is `title:` and other `key: value` lines, a blank line,
// then a JSON object with the VGL_OWN fields.
export function parseVglFile(text, name) {
  const [head, ...rest] = text.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  if (!/^title:\s*\S/m.test(head)) throw new Error(`${name}: missing "title:" header`);
  let own;
  try {
    own = JSON.parse(rest.join("\n\n"));
  } catch (err) {
    throw new Error(`${name}: body is not JSON (${err.message})`);
  }
  const missing = VGL_OWN.filter((k) => own[k] === undefined || own[k] === "");
  const unknown = Object.keys(own).filter((k) => !VGL_OWN.includes(k));
  if (missing.length) throw new Error(`${name}: missing ${missing.join(", ")}`);
  if (unknown.length) throw new Error(`${name}: unknown ${unknown.join(", ")}`);
  // The VGL guide's limit (huggingface.co/briaai/Fibo-2.0-dev, vgl/README.md).
  if (!Array.isArray(own.objects) || own.objects.length < 1 || own.objects.length > 5) throw new Error(`${name}: objects takes 1 to 5 entries`);
  return own;
}

// One still's full VGL caption, in the guide's field order.
export function vglCaption(own, fixed) {
  return {
    short_description: own.short_description,
    objects: own.objects,
    background_setting: own.background_setting,
    lighting: { conditions: fixed.lighting_conditions, direction: own.lighting_direction, shadows: fixed.lighting_shadows },
    aesthetics: { composition: own.composition, color_scheme: fixed.color_scheme, mood_atmosphere: fixed.mood_atmosphere },
    style_medium: fixed.style_medium,
    context: own.context,
    artistic_style: fixed.artistic_style,
  };
}

// Bria's content filter, from the plan: on for prompts and outputs unless the
// plan says "false". Batch 3 ran with it off, and its plan records that.
export function briaModeration(plan) {
  if (plan.moderation === "false") return { moderation: "false" };
  if (plan.moderation !== undefined && plan.moderation !== "true") throw new Error('plan moderation must be "true" or "false"');
  return {
    moderation: "true",
    "moderation.prompt_content_moderation": true,
    "moderation.visual_input_moderation": false,
    "moderation.visual_output_moderation": true,
  };
}

function buildBria(plan, sizes) {
  return buildVgl(plan, sizes.fibo, (it, size, caption) => ({
    tool: "run_template",
    name: plan.template,
    description: it.id,
    input_overrides: {
      [BRIA.node]: {
        prompt: "",
        structured_prompt: JSON.stringify(caption),
        aspect_ratio: size.aspect_ratio,
        resolution: size.resolution,
        seed: it.seed,
        ...briaModeration(plan),
      },
    },
  }), (size) => ({
    aspect_ratio: size.aspect_ratio,
    resolution: size.resolution,
    size_note: "the Bria node sets the pixels from aspect_ratio and resolution; record the real size after the run",
  }));
}

// The Space takes no moderation input: its app.py runs FIBO 2.0 Dev on the
// caption as sent (read 2026-11-03). A Space plan must say so, and why that
// is acceptable, so the record never implies a filter that did not run.
export function spaceModeration(plan) {
  if (plan.moderation !== "none") throw new Error(`a ${SPACE.template} plan must set moderation "none": the Space has no content filter`);
  if (typeof plan.moderation_why !== "string" || !plan.moderation_why.trim()) throw new Error("a Space plan must say in moderation_why why it runs unfiltered");
  return { moderation: "none", moderation_why: plan.moderation_why };
}

function buildSpace(plan, sizes) {
  spaceModeration(plan);
  return buildVgl(plan, sizes.fibo_space, (it, size, caption) => ({
    tool: "gradio",
    space: SPACE.space,
    api_name: SPACE.api,
    description: it.id,
    inputs: {
      prompt: "",
      json_prompt: JSON.stringify(caption),
      style: "None",
      seed: it.seed,
      randomize: false,
      width: size.width,
      height: size.height,
      steps: size.steps,
    },
  }), (size) => ({ width: size.width, height: size.height, steps: size.steps }));
}

// Both FIBO routes: the same captions and checks, a different item shape.
function buildVgl(plan, sizes, itemFor, settingsFor) {
  const fixed = JSON.parse(readText("vgl-style.txt"));
  const gap = VGL_FIXED.filter((k) => typeof fixed[k] !== "string" || !fixed[k]);
  if (gap.length) throw new Error(`vgl-style.txt: missing ${gap.join(", ")}`);
  checkDashes(JSON.stringify(fixed), "vgl-style.txt");
  const items = [];
  const manifest = [];
  for (const it of plan.items) {
    if (!Number.isSafeInteger(it.seed) || it.seed < 1 || it.seed > BRIA.maxSeed) throw new Error(`${it.id}: seed must be an integer from 1 to ${BRIA.maxSeed}`);
    const size = sizes?.[it.kind];
    if (!size) throw new Error(`${it.id}: sizes.json has no ${plan.template} size for kind ${it.kind}`);
    const name = `${it.prompt ?? it.id}.txt`;
    const raw = readText(name);
    checkDashes(raw, name);
    const caption = vglCaption(parseVglFile(raw, name), fixed);
    items.push(itemFor(it, size, caption));
    manifest.push({ id: it.id, out: `${it.id}.png`, kind: it.kind, prompt_file: `art/prompts/${name}`, seed: it.seed, ...settingsFor(size), count: 1 });
  }
  return { items, manifest };
}

export function build(n) {
  const plan = JSON.parse(fs.readFileSync(path.join(RUNS, `batch-${n}.plan.json`), "utf8"));
  const sizes = JSON.parse(readText("sizes.json"));
  if (plan.template === BRIA.template || plan.template === SPACE.template) {
    if (!Array.isArray(plan.items) || plan.items.length === 0) throw new Error("plan has no items");
    if (plan.items.length > MAX_ITEMS) throw new Error(`plan has ${plan.items.length} items; submit_batch takes ${MAX_ITEMS}`);
    const ids = plan.items.map((it) => it.id);
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) throw new Error(`duplicate id ${dup}`);
    if (plan.template === BRIA.template) return request(n, plan, buildBria(plan, sizes));
    return { ...request(n, plan, buildSpace(plan, sizes)), inbox: `art/inbox/batch-${n}/`, ...spaceModeration(plan) };
  }
  const quality = readText("quality.txt");
  const style = readText("style.txt");
  const negative = readText("negative.txt");
  for (const [t, w] of [[quality, "quality.txt"], [style, "style.txt"], [negative, "negative.txt"]]) checkDashes(t, w);

  if (!Array.isArray(plan.items) || plan.items.length === 0) throw new Error("plan has no items");
  if (plan.items.length > MAX_ITEMS) throw new Error(`plan has ${plan.items.length} items; submit_batch takes ${MAX_ITEMS}`);

  const seen = new Set();
  const items = [];
  const manifest = [];
  for (const it of plan.items) {
    if (seen.has(it.id)) throw new Error(`duplicate id ${it.id}`);
    seen.add(it.id);
    if (!Number.isSafeInteger(it.seed)) throw new Error(`${it.id}: seed must be an integer`);
    const size = sizes[it.kind];
    if (!size) throw new Error(`${it.id}: unknown kind ${it.kind}`);
    const name = `${it.prompt ?? it.id}.txt`;
    const raw = readText(name);
    checkDashes(raw, name);
    const file = parsePromptFile(raw, name);
    if ("dataset" in it) throw new Error(`${it.id}: "dataset" is retired; prompts carry no dataset tag`);
    const prompt = composePrompt({ file, quality, style, tail: size.tail });
    const neg = [negative, file.negative].filter(Boolean).join(", ");

    items.push({
      tool: "run_template",
      name: plan.template,
      description: it.id,
      slot_overrides: { [SLOT.prompt]: prompt, [SLOT.negative]: neg, [SLOT.seed]: it.seed },
      input_overrides: {
        [SIZE_NODE]: { aspect_ratio: size.aspect_ratio, megapixels: size.megapixels, multiple: size.multiple },
      },
    });
    manifest.push({
      id: it.id,
      out: `${it.id}.png`,
      kind: it.kind,
      prompt_file: `art/prompts/${name}`,
      dataset_line: false, // kept so the format stays stable; always false since 2026-10-18
      seed: it.seed,
      width: size.expect[0],
      height: size.expect[1],
      size_note: `expected from node 91 (${size.aspect_ratio}, ${size.megapixels} MP, multiple ${size.multiple}); record the real size after the run`,
      ...TEMPLATE_FIXED,
      count: 1,
    });
  }
  return request(n, plan, { items, manifest });
}

function request(n, plan, { items, manifest }) {
  return {
    _generated: `By art/tools/build-batch.mjs from art/runs/batch-${n}.plan.json and art/prompts/. Edit those, then rerun; never edit this file.`,
    batch: plan.batch,
    date: plan.date,
    purpose: plan.purpose,
    template: plan.template,
    client_os: "darwin",
    count_per_prompt: 1,
    image_count: items.length,
    inbox: `art-inbox/batch-${n}/`,
    estimate: plan.estimate ?? null,
    items,
    manifest,
  };
}

function main() {
  const args = process.argv.slice(2);
  const n = args.find((a) => /^\d+$/.test(a));
  if (!n) usage("missing batch number");
  const out = path.join(RUNS, `batch-${n}.json`);
  let next;
  try {
    next = `${JSON.stringify(build(n), null, 2)}\n`;
  } catch (err) {
    console.error(`build-batch: ${err.message}`);
    process.exit(1);
  }
  if (args.includes("--check")) {
    const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
    if (current !== next) {
      console.error(`build-batch: ${path.relative(process.cwd(), out)} is stale; rerun without --check`);
      process.exit(1);
    }
    console.log(`build-batch: batch-${n}.json is current`);
    return;
  }
  fs.writeFileSync(out, next);
  console.log(`build-batch: wrote ${path.relative(process.cwd(), out)} (${JSON.parse(next).image_count} images)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
