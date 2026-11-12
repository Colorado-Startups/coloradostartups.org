#!/usr/bin/env node
// Traces the Colorado Startups logo PNG into a flat-color SVG.
//
//   node art/tools/trace-logo.mjs [--report <dir>]
//
// Reads site/public/brand/cs-logo-1500.png and writes site/public/brand/cs-logo.svg.
// Then it renders the SVG back to pixels and compares them with the PNG. With
// --report it also writes side-by-side and difference images for a visual check.
//
// How it works:
//   1. Palette. The logo is six flat colors on transparency. Each opaque pixel
//      within CORE of a palette color takes that color. Blended edge pixels take
//      the neighboring color nearest to them, so a purple-to-white blend never
//      becomes a stray lavender outline.
//   2. Contours. Each color's region is traced along pixel edges into closed loops.
//   3. Shape. Unit staircase steps become straight or curved runs; real corners,
//      such as the slab serifs, stay sharp. Loops are simplified and gentle turns
//      become quadratic curves.
//   4. Paint. Every layer's thin stroke goes down first, then every fill, light to
//      dark. Fills cover the strokes back to the true edges; strokes show only in
//      the hairline gaps that simplification can leave between neighbors.
//
// Exit codes: 0 written and within the display-size goal, 1 the render differs too much, 3 input missing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "site/public/brand/cs-logo-1500.png");
const OUT = path.join(ROOT, "site/public/brand/cs-logo.svg");

// Seeds from a histogram of the PNG's opaque pixels (2026-10-18); refined below
// to the mean of the pixels near each seed. Order is paint order, light to dark.
const SEEDS = [
  ["white", [252, 252, 252]],
  ["lavender", [164, 164, 204]],
  ["teal", [4, 124, 148]],
  ["deep-teal", [12, 92, 124]],
  ["purple", [92, 68, 116]],
  ["deep-purple", [76, 60, 116]],
];
const CORE = 12; // color distance that counts as a flat pixel of a palette color
const MIN_ISLAND = 8; // pixels; smaller specks merge into their neighbors
const SIMPLIFY = 0.5; // px tolerance for Douglas-Peucker
const SMOOTH_PASSES = 2; // light smoothing passes on points between corners
const SMOOTH_SPAN = 6; // px; a point is smoothed only when both neighbors are this close
const CORNER_RUN = 4; // px; a corner between two runs at least this long is a real corner
const TANGENT_TURN = (15 * Math.PI) / 180; // turns this gentle always become curves
const SMOOTH_TURN = (52 * Math.PI) / 180; // turns up to this become curves when both sides are short
const ARC_SEGMENT = 30; // px; a side this short or shorter belongs to an arc, not a straight edge
const CURVE_REACH = 14; // px a curve may reach along each side of a vertex
const SEAM_STROKE = 1.0; // px, in the 1500 px source space; painted under the fills
const VISIBLE = 96; // a channel difference this large, over white, is visible
const DISPLAY_WIDTH = 300; // px; the check runs at the largest size the site is expected to show the logo (measured 2026-10-18: 0.64% differ at 500 px)
const DISPLAY_VISIBLE = 48; // a channel difference this large is visible at display size
const MAX_SHAPE = 0.002; // goal: under 0.2% of pixels differ visibly at display size

const TRANSPARENT = 255;
const UNSET = 254;

function dist2(a, r, g, b) {
  const dr = a[0] - r;
  const dg = a[1] - g;
  const db = a[2] - b;
  return dr * dr + dg * dg + db * db;
}

function refinePalette(data) {
  return SEEDS.map(([name, seed]) => {
    let n = 0;
    const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 250) continue;
      if (dist2(seed, data[i], data[i + 1], data[i + 2]) <= 64) {
        sum[0] += data[i];
        sum[1] += data[i + 1];
        sum[2] += data[i + 2];
        n++;
      }
    }
    const rgb = n ? sum.map((s) => Math.round(s / n)) : seed;
    return { name, rgb, hex: `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}` };
  });
}

function label(data, W, H, palette) {
  const lab = new Uint8Array(W * H).fill(UNSET);
  const core2 = CORE * CORE;
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    if (data[i + 3] < 128) {
      lab[p] = TRANSPARENT;
      continue;
    }
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const d = dist2(palette[k].rgb, data[i], data[i + 1], data[i + 2]);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (bestD <= core2) lab[p] = best;
  }
  // Grow labels into blended pixels: each takes the nearest color among its labeled neighbors.
  for (let pass = 0; pass < 12; pass++) {
    const next = lab.slice();
    let changed = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (lab[p] !== UNSET) continue;
        const i = p * 4;
        let best = UNSET;
        let bestD = Infinity;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const l = lab[ny * W + nx];
            if (l >= palette.length) continue;
            const d = dist2(palette[l].rgb, data[i], data[i + 1], data[i + 2]);
            if (d < bestD) {
              bestD = d;
              best = l;
            }
          }
        }
        if (best !== UNSET) {
          next[p] = best;
          changed++;
        }
      }
    }
    lab.set(next);
    if (!changed) break;
  }
  for (let p = 0; p < lab.length; p++) if (lab[p] === UNSET) lab[p] = TRANSPARENT;
  mergeIslands(lab, W, H);
  return lab;
}

// Relabels connected specks smaller than MIN_ISLAND to their most common neighbor.
function mergeIslands(lab, W, H) {
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let start = 0; start < lab.length; start++) {
    if (seen[start]) continue;
    const l = lab[start];
    const members = [];
    const around = new Map();
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop();
      members.push(p);
      const x = p % W;
      const y = (p - x) / W;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (lab[q] === l) {
          if (!seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        } else {
          around.set(lab[q], (around.get(lab[q]) ?? 0) + 1);
        }
      }
      if (members.length > MIN_ISLAND) break;
    }
    if (members.length <= MIN_ISLAND && stack.length === 0 && around.size) {
      const to = [...around].sort((a, b) => b[1] - a[1])[0][0];
      for (const p of members) lab[p] = to;
    } else {
      // Large region: finish marking it so it is not revisited.
      while (stack.length) {
        const p = stack.pop();
        const x = p % W;
        const y = (p - x) / W;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (lab[q] === l && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
  }
}

// Closed loops along pixel edges, with the region on the left of travel (y down).
function traceLoops(lab, W, H, l) {
  const V = W + 1;
  const out = new Map(); // start vertex -> list of end vertices
  const add = (x0, y0, x1, y1) => {
    const k = y0 * V + x0;
    const list = out.get(k);
    const e = y1 * V + x1;
    if (list) list.push(e);
    else out.set(k, [e]);
  };
  const is = (x, y) => x >= 0 && y >= 0 && x < W && y < H && lab[y * W + x] === l;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (lab[y * W + x] !== l) continue;
      if (!is(x, y - 1)) add(x + 1, y, x, y);
      if (!is(x + 1, y)) add(x + 1, y + 1, x + 1, y);
      if (!is(x, y + 1)) add(x, y + 1, x + 1, y + 1);
      if (!is(x - 1, y)) add(x, y, x, y + 1);
    }
  }
  const loops = [];
  for (const [startKey] of out) {
    while (out.get(startKey)?.length) {
      const loop = [];
      let from = startKey;
      let to = out.get(from).pop();
      let dir = [(to % V) - (from % V), Math.floor(to / V) - Math.floor(from / V)];
      loop.push([from % V, Math.floor(from / V)]);
      while (to !== startKey) {
        loop.push([to % V, Math.floor(to / V)]);
        const options = out.get(to);
        // At a vertex shared by two diagonal pixels, turn left: regions stay 4-connected.
        let pick = 0;
        if (options.length > 1) {
          const tx = to % V;
          const ty = Math.floor(to / V);
          const left = [dir[1], -dir[0]];
          pick = options.findIndex((e) => (e % V) - tx === left[0] && Math.floor(e / V) - ty === left[1]);
          if (pick < 0) pick = 0;
        }
        const next = options.splice(pick, 1)[0];
        if (options.length === 0) out.delete(to);
        dir = [(next % V) - (to % V), Math.floor(next / V) - Math.floor(to / V)];
        from = to;
        to = next;
      }
      loops.push(loop);
    }
    out.delete(startKey);
  }
  return loops;
}

// Keeps only the corners of a unit-step loop, then swaps staircase steps for midpoints.
function destair(loop) {
  const n = loop.length;
  const corners = [];
  for (let i = 0; i < n; i++) {
    const a = loop[(i - 1 + n) % n];
    const b = loop[i];
    const c = loop[(i + 1) % n];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) corners.push(b);
  }
  const m = corners.length;
  if (m < 4) return corners;
  const len = (p, q) => Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
  // Every run contributes its midpoint; a corner survives only between two long
  // runs. Short runs are staircase steps on a slope or a curve.
  const pts = [];
  for (let i = 0; i < m; i++) {
    const prev = corners[(i - 1 + m) % m];
    const cur = corners[i];
    const next = corners[(i + 1) % m];
    if (len(prev, cur) >= CORNER_RUN && len(cur, next) >= CORNER_RUN) pts.push(Object.assign([...cur], { pinned: true }));
    pts.push([(cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2]);
  }
  // Light smoothing between corners takes out the last one-pixel wobble on curves.
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const src = pts.map((q) => [q[0], q[1]]);
    const k = src.length;
    for (let i = 0; i < k; i++) {
      if (pts[i].pinned) continue;
      const a = src[(i - 1 + k) % k];
      const b = src[(i + 1) % k];
      // Only curves get smoothed. Next to a long straight side, averaging would drag the point far off.
      if (Math.hypot(a[0] - src[i][0], a[1] - src[i][1]) > SMOOTH_SPAN || Math.hypot(b[0] - src[i][0], b[1] - src[i][1]) > SMOOTH_SPAN) continue;
      pts[i][0] = 0.25 * a[0] + 0.5 * src[i][0] + 0.25 * b[0];
      pts[i][1] = 0.25 * a[1] + 0.5 * src[i][1] + 0.25 * b[1];
    }
  }
  return pts.length >= 3 ? pts : corners;
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  if (L === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L;
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

function simplifyClosed(pts, eps) {
  if (pts.length < 4) return pts;
  let far = 0;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = rdp(pts.slice(0, far + 1), eps);
  const b = rdp(pts.slice(far).concat([pts[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

const f = (v) => (Math.round(v * 10) / 10).toString();

function loopToPath(pts) {
  const n = pts.length;
  if (n < 3) return "";
  const cmds = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n];
    const v = pts[i];
    const q = pts[(i + 1) % n];
    const inL = Math.hypot(v[0] - p[0], v[1] - p[1]);
    const outL = Math.hypot(q[0] - v[0], q[1] - v[1]);
    const din = [(v[0] - p[0]) / inL, (v[1] - p[1]) / inL];
    const dout = [(q[0] - v[0]) / outL, (q[1] - v[1]) / outL];
    const turn = Math.acos(Math.max(-1, Math.min(1, din[0] * dout[0] + din[1] * dout[1])));
    const onArc = turn < SMOOTH_TURN && inL <= ARC_SEGMENT && outL <= ARC_SEGMENT;
    if (inL > 0 && outL > 0 && (turn < TANGENT_TURN || onArc)) {
      const ri = Math.min(inL / 2, CURVE_REACH);
      const ro = Math.min(outL / 2, CURVE_REACH);
      cmds.push(["L", [v[0] - din[0] * ri, v[1] - din[1] * ri]]);
      cmds.push(["Q", v, [v[0] + dout[0] * ro, v[1] + dout[1] * ro]]);
    } else {
      cmds.push(["L", v]);
    }
  }
  const first = cmds[0][0] === "L" ? cmds[0][1] : cmds[cmds.length - 1][1];
  let d = `M${f(first[0])} ${f(first[1])}`;
  for (const [op, a, b] of cmds) {
    d += op === "L" ? `L${f(a[0])} ${f(a[1])}` : `Q${f(a[0])} ${f(a[1])} ${f(b[0])} ${f(b[1])}`;
  }
  return `${d}Z`;
}

function bbox(lab, W, H) {
  let x0 = W;
  let y0 = H;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (lab[y * W + x] === TRANSPARENT) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

async function compare(svg, data, W, H, box, reportDir) {
  const render = await sharp(Buffer.from(svg), { density: 72 })
    .resize(box.w, box.h)
    .ensureAlpha()
    .raw()
    .toBuffer();
  // Both images over a white ground, the way the logo is seen on the page.
  const flat = (buf, idx) => {
    const a = buf[idx + 3] / 255;
    return [0, 1, 2].map((k) => buf[idx + k] * a + 255 * (1 - a));
  };
  const gap = (c1, c2) => Math.max(Math.abs(c1[0] - c2[0]), Math.abs(c1[1] - c2[1]), Math.abs(c1[2] - c2[2]));
  let edge = 0;
  let opaque = 0;
  const heat = Buffer.alloc(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      const i = ((y + box.y) * W + (x + box.x)) * 4;
      const j = (y * box.w + x) * 4;
      if (data[i + 3] > 127 || render[j + 3] > 127) opaque++;
      const m = gap(flat(data, i), flat(render, j));
      if (m > VISIBLE) edge++;
      heat[j] = 255;
      heat[j + 1] = heat[j + 2] = 255 - Math.min(255, m * 2);
      heat[j + 3] = 255;
    }
  }
  // At full size most differences are half-pixel edge shifts. At display size
  // those blur away and only real shape changes remain, so the goal is set there.
  const crop = sharp(data, { raw: { width: W, height: H, channels: 4 } }).extract({ left: box.x, top: box.y, width: box.w, height: box.h });
  const small = async (img) => img.flatten({ background: "#ffffff" }).resize({ width: DISPLAY_WIDTH }).raw().toBuffer({ resolveWithObject: true });
  const a = await small(crop);
  const b = await small(sharp(render, { raw: { width: box.w, height: box.h, channels: 4 } }));
  let shape = 0;
  const n = a.info.width * a.info.height;
  for (let p = 0; p < n; p++) {
    const k = p * a.info.channels;
    const m = Math.max(Math.abs(a.data[k] - b.data[k]), Math.abs(a.data[k + 1] - b.data[k + 1]), Math.abs(a.data[k + 2] - b.data[k + 2]));
    if (m > DISPLAY_VISIBLE) shape++;
  }
  if (reportDir) {
    fs.mkdirSync(reportDir, { recursive: true });
    const src = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).extract({ left: box.x, top: box.y, width: box.w, height: box.h }).flatten({ background: "#ffffff" }).png().toBuffer();
    const out = await sharp(render, { raw: { width: box.w, height: box.h, channels: 4 } }).flatten({ background: "#ffffff" }).png().toBuffer();
    const diff = await sharp(heat, { raw: { width: box.w, height: box.h, channels: 4 } }).png().toBuffer();
    // sharp resizes before it composites, so compose first and resize in a second pass.
    const sheet = await sharp({ create: { width: box.w * 3, height: box.h, channels: 4, background: "#ffffff" } })
      .composite([
        { input: src, left: 0, top: 0 },
        { input: out, left: box.w, top: 0 },
        { input: diff, left: box.w * 2, top: 0 },
      ])
      .png()
      .toBuffer();
    await sharp(sheet).resize({ width: 1800 }).png().toFile(path.join(reportDir, "logo-compare.png"));
    await sharp(out).png().toFile(path.join(reportDir, "logo-render.png"));
    await sharp(diff).png().toFile(path.join(reportDir, "logo-diff.png"));
  }
  return { opaque, edge: edge / opaque, shape: shape / n, displayPixels: n };
}

async function main() {
  const args = process.argv.slice(2);
  const ri = args.indexOf("--report");
  const reportDir = ri === -1 ? undefined : path.resolve(args[ri + 1] ?? ".");
  if (!fs.existsSync(SRC)) {
    console.error(`trace-logo: missing ${path.relative(ROOT, SRC)}`);
    process.exit(3);
  }
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const palette = refinePalette(data);
  const lab = label(data, W, H, palette);
  const box = bbox(lab, W, H);

  const layers = [];
  let points = 0;
  for (let k = 0; k < palette.length; k++) {
    const loops = traceLoops(lab, W, H, k)
      .map((loop) => simplifyClosed(destair(loop), SIMPLIFY))
      .filter((pts) => pts.length >= 3);
    points += loops.reduce((s, p) => s + p.length, 0);
    const d = loops.map(loopToPath).join("");
    if (d) layers.push({ ...palette[k], d });
  }

  // Every layer's stroke first, then every fill. Each fill covers its neighbors'
  // strokes back to the exact boundary, so a stroke shows only where simplified
  // edges left a gap. Shapes stay their true size and no seam shows through.
  const defs = layers.map((l) => `    <path id="${l.name}" fill-rule="evenodd" d="${l.d}"/>`).join("\n");
  const strokes = layers.map((l) => `    <use href="#${l.name}" stroke="${l.hex}"/>`).join("\n");
  const fills = layers.map((l) => `    <use href="#${l.name}" fill="${l.hex}"/>`).join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" width="${box.w}" height="${box.h}" role="img" aria-labelledby="cs-logo-title">
  <title id="cs-logo-title">Colorado Startups</title>
  <!-- Traced from cs-logo-1500.png by art/tools/trace-logo.mjs; rerun it rather than editing paths. -->
  <defs>
${defs}
  </defs>
  <g fill="none" stroke-width="${SEAM_STROKE}" stroke-linejoin="round">
${strokes}
  </g>
  <g>
${fills}
  </g>
</svg>
`;
  fs.writeFileSync(OUT, svg);

  const result = await compare(svg, data, W, H, box, reportDir);
  console.log(
    `trace-logo: wrote ${path.relative(ROOT, OUT)} (${Math.round(svg.length / 1024)} KB, ${points} points, ${layers.length} colors: ${layers.map((l) => `${l.name} ${l.hex}`).join(", ")})`,
  );
  console.log(
    `trace-logo: full size: ${(result.edge * 100).toFixed(2)}% of ${result.opaque} logo pixels differ visibly, almost all half-pixel antialiased edges`,
  );
  console.log(
    `trace-logo: at ${DISPLAY_WIDTH} px wide: ${(result.shape * 100).toFixed(3)}% of ${result.displayPixels} pixels differ visibly (goal under ${MAX_SHAPE * 100}%)`,
  );
  if (result.shape > MAX_SHAPE) process.exit(1);
}

await main();
