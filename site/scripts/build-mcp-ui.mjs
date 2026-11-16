// Generates site/worker/mcp/ui/apps.generated.ts: the two MCP Apps cards the
// /mcp server returns from resources/read, each one self-contained HTML
// document with its CSS, its script and its map inline. Run it by hand,
// `cd site && node scripts/build-mcp-ui.mjs`, and commit the output; the
// build does not run it. The output is never edited by hand:
// test/unit/mcp/ui.test.ts regenerates it in memory and fails on any difference.
//
// Inputs, each read from its one source:
//   worker/mcp/ui/view.mjs, bridge.mjs   the card's script, inlined without `export`
//   01_doctrine/brand_tokens.yaml        colors (light and night), spacing, radii
//   data/geo/views.json                  each region's map frame, Web Mercator
//   data/geo/regions.geojson             each region's loop, cities and name
//   data/geo/colorado.geojson            the state outline, for the locator
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
export const TARGET = resolve(here, "../worker/mcp/ui/apps.generated.ts");
const read = (path) => readFileSync(resolve(root, path), "utf8");

/** The cap on one card's HTML, in bytes. test/unit/mcp/ui.test.ts checks it too. */
export const MAX_HTML_BYTES = 40 * 1024;

// The token roles the cards use, by their name in brand_tokens.yaml.
export const COLOR_ROLES = ["ground", "surface", "surface-2", "rule", "border", "text", "text-dim", "accent", "on-accent", "link", "focus"];
export const SPACE_STEPS = ["1", "2", "3", "4", "5"];
export const RADII = ["chisel", "card"];

/** The CSS custom properties for the light set, the night set and the lengths. */
export function tokenCss(doc) {
  const light = COLOR_ROLES.map((r) => {
    const v = doc.color?.[r];
    if (typeof v !== "string") throw new Error(`brand_tokens.yaml has no color.${r}`);
    return `--c-${r}:${v};`;
  });
  const night = COLOR_ROLES.filter((r) => doc.night?.[r] !== undefined).map((r) => `--c-${r}:${doc.night[r]};`);
  const lengths = [
    ...SPACE_STEPS.map((s) => `--s-${s}:${doc.space[s]};`),
    ...RADII.map((r) => `--r-${r}:${doc.radius[r]};`),
  ];
  const nightBlock = `color-scheme:dark;${night.join("")}`;
  return [
    `:root{color-scheme:light;${light.join("")}${lengths.join("")}}`,
    // Dark when the host says so; without a host theme, the reader's system setting decides.
    `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${nightBlock}}}`,
    `:root[data-theme="dark"]{${nightBlock}}`,
  ].join("");
}

// Map label sizing. A label is LABEL_PX in the map's own units; the map is
// drawn at most MAP_MAX_PX wide, inside #app's padding (space token 4) and a
// 1 px border. Below LABELS_MIN_VIEWPORT the labels would render under
// MIN_LABEL_PX, so they are hidden there and the caption names the region.
// test/unit/mcp/ui.test.ts checks the arithmetic.
export const LABEL_PX = 22;
export const MIN_LABEL_PX = 12;
export const MAP_MAX_PX = 416;
export const APP_PAD_PX = 16;
export const LABELS_MIN_VIEWPORT = 400;

const CARD_CSS = [
  `*{box-sizing:border-box}`,
  `html,body{margin:0;background:var(--c-ground);color:var(--c-text)}`,
  `body{font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}`,
  `#app{padding:${APP_PAD_PX}px;max-width:40rem}`,
  `h1{font-size:1.15rem;margin:0}`,
  `h2{font-size:.95rem;margin:var(--s-4) 0 var(--s-2)}`,
  `p{margin:0}`,
  `.sub,.meta,.credit{color:var(--c-text-dim)}`,
  `.sub{margin-top:var(--s-1);font-size:.9rem}`,
  `.note,.summary{margin-top:var(--s-3)}`,
  `.cards,.list{list-style:none;margin:var(--s-3) 0 0;padding:0;display:grid;gap:var(--s-2)}`,
  `.ev{background:var(--c-surface);border:1px solid var(--c-rule);border-radius:var(--r-card);padding:var(--s-2) var(--s-3)}`,
  `.when{font-size:.85rem;font-weight:600}`,
  `.time{color:var(--c-text-dim);font-weight:400}`,
  `.title{font-weight:600;margin:2px 0}`,
  `.ev .meta{font-size:.85rem;display:flex;flex-wrap:wrap;gap:var(--s-2);align-items:center}`,
  // Yellow is a fill behind State Blue text, never text on white.
  `.tag{background:var(--c-accent);color:var(--c-on-accent);border-radius:var(--r-chisel);padding:0 var(--s-1)}`,
  `.list .meta{font-size:.85rem}`,
  `a{color:var(--c-link);text-decoration:underline;text-underline-offset:2px}`,
  `a:focus-visible{outline:2px solid var(--c-focus);outline-offset:2px}`,
  `.more{margin-top:var(--s-3)}`,
  `.credit{margin-top:var(--s-4);font-size:.75rem}`,
  `.map{margin:var(--s-3) 0 0}`,
  `.map figcaption{margin-top:var(--s-1);font-size:.85rem;color:var(--c-text-dim)}`,
  `.url{font-weight:600;overflow-wrap:anywhere}`,
  `.map svg{display:block;width:100%;max-width:${MAP_MAX_PX}px;height:auto;background:var(--c-surface);border:1px solid var(--c-rule);border-radius:var(--r-card)}`,
  `.map .st{fill:var(--c-ground);stroke:var(--c-border);stroke-width:2}`,
  `.map .zo{fill:var(--c-text-dim);stroke:none}`,
  `.map .zf{fill:var(--c-accent);stroke:var(--c-text);stroke-width:3;stroke-linejoin:round}`,
  `.map .lc{fill:none;stroke:var(--c-text);stroke-width:6}`,
  `.map .cy{fill:var(--c-text);stroke:var(--c-ground);stroke-width:3}`,
  `.map text{font:600 ${LABEL_PX}px system-ui,sans-serif;fill:var(--c-text);stroke:var(--c-ground);stroke-width:5px;paint-order:stroke;stroke-linejoin:round}`,
  `@media (max-width:${LABELS_MIN_VIEWPORT - 0.02}px){.map text{display:none}}`,
].join("");

// --- The map: the site's own geography, in the frames the site's maps use. ---

// Web Mercator's north-south axis, as site/src/lib/regions/colorado-views.ts has it.
const mercY = (lat) => (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** A lon/lat point in a frame's pixels, the projection colorado-views.ts `inFrame` uses. */
export function toPx(frame, [lon, lat]) {
  const [top, bottom] = [mercY(frame.north), mercY(frame.south)];
  return [((lon - frame.west) / (frame.east - frame.west)) * frame.width, ((top - mercY(lat)) / (top - bottom)) * frame.height];
}

/**
 * Douglas-Peucker: drop each point closer than `tolerance` px to the line its
 * neighbours keep. A closed ring is split at its point farthest from the
 * start, since a ring's two ends are the same point and span no line.
 */
export function simplify(points, tolerance) {
  if (points.length <= 3) return points;
  const [fx, fy] = points[0];
  const [lx, ly] = points[points.length - 1];
  if (fx === lx && fy === ly) {
    let k = 1;
    for (let i = 1; i < points.length - 1; i++) {
      if (Math.hypot(points[i][0] - fx, points[i][1] - fy) > Math.hypot(points[k][0] - fx, points[k][1] - fy)) k = i;
    }
    return [...simplifyLine(points.slice(0, k + 1), tolerance), ...simplifyLine(points.slice(k), tolerance).slice(1)];
  }
  return simplifyLine(points, tolerance);
}

function simplifyLine(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1;
    let at = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > far) [far, at] = [d, i];
    }
    if (far > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const r0 = (n) => Math.round(n);
const pathOf = (pts) => `M${pts.map(([x, y]) => `${r0(x)} ${r0(y)}`).join("L")}Z`;
const escXml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

const CHAR_W = 0.56 * LABEL_PX;
const INSET_SCALE = 0.22;
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * One region's map: its loop, filled Yellow, and its cities, in the region's
 * own frame; a locator of the whole state in the corner the drawing leaves
 * most open, with the three regions at their true size and this one ringed.
 */
export function regionMapSvg(id, views, zones, outline) {
  const frame = views[`zone-${id}`];
  const zone = zones.features.find((z) => z.id === id);
  if (!frame || !zone) throw new Error(`data/geo has no frame or zone for ${id}`);
  const { width: W, height: H } = frame;
  const ring = simplify(zone.geometry.coordinates[0].map((p) => toPx(frame, p)), 1);
  const cities = zone.properties.cityPoints.map((c) => ({ name: c.name, at: toPx(frame, [c.lon, c.lat]) }));

  // The locator's corner: the one with the fewest loop and city points under it.
  const state = views.state;
  const [iw, ih] = [state.width * INSET_SCALE, state.height * INSET_SCALE];
  const pad = 10;
  const corners = [
    [W - iw - pad, pad],
    [pad, pad],
    [W - iw - pad, H - ih - pad],
    [pad, H - ih - pad],
  ];
  const pts = [...ring, ...cities.map((c) => c.at)];
  const inBox = ([x0, y0]) => pts.filter(([x, y]) => x >= x0 - 30 && x <= x0 + iw + 30 && y >= y0 - 30 && y <= y0 + ih + 30).length;
  const [ix, iy] = corners.reduce((best, c) => (inBox(c) < inBox(best) ? c : best));
  const insetBox = { left: ix, right: ix + iw, top: iy, bottom: iy + ih };

  // City names right of each dot, else left, else above; a name that fits nowhere is left to the list.
  const taken = [insetBox, ...cities.map(({ at: [x, y] }) => ({ left: x - 7, right: x + 7, top: y - 7, bottom: y + 7 }))];
  const labels = [];
  for (const { name, at: [x, y] } of cities) {
    const w = name.length * CHAR_W;
    const options = [
      { x: x + 11, y: y + 8, anchor: "start", box: { left: x + 9, right: x + 13 + w, top: y - 13, bottom: y + 11 } },
      { x: x - 11, y: y + 8, anchor: "end", box: { left: x - 13 - w, right: x - 9, top: y - 13, bottom: y + 11 } },
      { x, y: y - 13, anchor: "middle", box: { left: x - w / 2 - 2, right: x + w / 2 + 2, top: y - 35, bottom: y - 9 } },
    ];
    const fit = options.find((o) => o.box.left >= 2 && o.box.right <= W - 2 && o.box.top >= 2 && o.box.bottom <= H - 2 && !taken.some((t) => overlaps(t, o.box)));
    if (!fit) continue;
    taken.push(fit.box);
    labels.push(`<text x="${r0(fit.x)}" y="${r0(fit.y)}" text-anchor="${fit.anchor}">${escXml(name)}</text>`);
  }

  // The locator: the state, the other two regions in grey, this one Yellow and ringed.
  const statePath = pathOf(outline.features[0].geometry.coordinates[0].map((p) => toPx(state, p)));
  const zonePaths = zones.features.map((z) => {
    const p = simplify(z.geometry.coordinates[0].map((q) => toPx(state, q)), 0.5);
    return `<path class="${z.id === id ? "zf" : "zo"}" d="${pathOf(p)}"/>`;
  });
  const [cx, cy] = toPx(state, [
    zone.properties.cityPoints.reduce((s, c) => s + c.lon, 0) / zone.properties.cityPoints.length,
    zone.properties.cityPoints.reduce((s, c) => s + c.lat, 0) / zone.properties.cityPoints.length,
  ]);

  const name = zone.properties.name;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of ${escXml(name)}: ${escXml(zone.properties.cities.join(", "))}">`,
    `<path class="zf" d="${pathOf(ring)}"/>`,
    ...cities.map(({ at: [x, y] }) => `<circle class="cy" cx="${r0(x)}" cy="${r0(y)}" r="7"/>`),
    ...labels,
    `<g transform="translate(${r0(ix)} ${r0(iy)}) scale(${INSET_SCALE})">`,
    `<path class="st" d="${statePath}" vector-effect="non-scaling-stroke"/>`,
    ...zonePaths,
    `<circle class="lc" cx="${r0(cx)}" cy="${r0(cy)}" r="36"/>`,
    `</g>`,
    `</svg>`,
  ].join("");
}

/** A module's source as a classic script: its `export` keywords dropped. */
export function inlineModule(source) {
  if (/^\s*import\s/m.test(source)) throw new Error("a card module must not import anything");
  return source.replace(/^export\s+/gm, "");
}

// A script must not close its own <script> element.
const scriptSafe = (js) => js.replace(/<\/(script)/gi, "<\\/$1");

function cardHtml({ title, kind, css, script, names, maps }) {
  const boot =
    `const NAMES=${JSON.stringify(names)};const MAPS=${JSON.stringify(maps)};` +
    (kind === "week"
      ? `startCard(window,document,(result)=>renderWeek(toolData(result),NAMES),()=>fallbackHtml(WEEK_PAGE));`
      : `startCard(window,document,(result,input)=>renderRegion(toolData(result),NAMES,MAPS,input),(input)=>fallbackHtml(regionPage(input,NAMES)));`);
  return [
    `<!doctype html><html lang="en"><head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${title}</title><style>${css}</style></head>`,
    `<body><main id="app" aria-live="polite"><p class="note">Loading</p></main>`,
    `<script>"use strict";(()=>{${scriptSafe(script)}\n${scriptSafe(boot)}})();</script>`,
    `</body></html>`,
  ].join("");
}

/** Both cards' HTML, from the sources above. */
export function renderCards() {
  const tokens = parse(read("01_doctrine/brand_tokens.yaml"));
  const views = JSON.parse(read("data/geo/views.json"));
  const zones = JSON.parse(read("data/geo/regions.geojson"));
  const outline = JSON.parse(read("data/geo/colorado.geojson"));
  const script = [inlineModule(read("site/worker/mcp/ui/view.mjs")), inlineModule(read("site/worker/mcp/ui/bridge.mjs"))].join("\n");
  const css = tokenCss(tokens) + CARD_CSS;
  const names = Object.fromEntries(zones.features.map((z) => [z.id, z.properties.name]));
  const maps = Object.fromEntries(zones.features.map((z) => [z.id, regionMapSvg(z.id, views, zones, outline)]));
  const cards = {
    thisWeek: cardHtml({ title: "This week for Colorado founders", kind: "week", css, script, names, maps: {} }),
    region: cardHtml({ title: "A Colorado Startups region", kind: "region", css, script, names, maps }),
  };
  for (const [name, html] of Object.entries(cards)) {
    const bytes = Buffer.byteLength(html, "utf8");
    if (bytes > MAX_HTML_BYTES) throw new Error(`the ${name} card is ${bytes} bytes, over the ${MAX_HTML_BYTES}-byte cap`);
    // ASCII only, so a host that loads the HTML without its charset still shows every character.
    // eslint-disable-next-line no-control-regex
    if (/[^\x00-\x7f]/.test(html)) throw new Error(`the ${name} card has a non-ASCII character; write it as an HTML entity`);
  }
  return cards;
}

/** The generated module's text. */
export function renderModule() {
  const { thisWeek, region } = renderCards();
  return [
    "// Generated by site/scripts/build-mcp-ui.mjs from worker/mcp/ui/view.mjs, bridge.mjs,",
    "// 01_doctrine/brand_tokens.yaml and data/geo/. Do not edit: run node scripts/build-mcp-ui.mjs.",
    `export const THIS_WEEK_HTML = ${JSON.stringify(thisWeek)};`,
    `export const REGION_HTML = ${JSON.stringify(region)};`,
    "",
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(TARGET, renderModule());
}
