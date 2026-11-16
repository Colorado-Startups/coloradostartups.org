// node --test quality/collectors/engagement/engagement.test.mjs
// Every input is made here: a fake site answers each GET from the pages
// below, and a repo is written to a temp folder. No test reaches the network.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";

import { attributes, countMarks, elements, markValues, parseMark, sitemapLocs } from "./engagement-html.mjs";
import { area, collect } from "./engagement.mjs";

const ORIGIN = "https://site.example";
const NOW = new Date("2026-11-16T12:00:00Z");

// ---------- a fake site ----------

// Each path's answer: a page's HTML, or { status, location } for a redirect, or { status } alone.
function fakeSite(routes, calls = []) {
  return async (url, opts = {}) => {
    const u = new URL(url);
    calls.push(`${opts.redirect ?? "follow"} ${u.pathname}`);
    if (u.origin !== ORIGIN) throw new Error(`the test left the site for ${u.host}`);
    const r = routes[u.pathname];
    if (r === undefined) return new Response("<h1>Not found</h1>", { status: 404 });
    if (r instanceof Error) throw r;
    if (typeof r === "string") return new Response(r, { status: 200, headers: { "content-type": "text/html" } });
    return new Response(null, { status: r.status, headers: r.location ? { location: r.location } : {} });
  };
}

const HOME = `<!doctype html><html><head><title>Home <b></title>
<script>if (a < b) x = "<li data-builder='ghost'>";</script></head><body>
<ul data-builders><li data-builder="acme"><a href="/x">Acme</a></li><li data-builder="bolt">Bolt</li><li data-builder="acme">Acme again</li></ul>
<div data-this-week><ol>
  <li data-starts="2026-11-17T15:00:00Z">One</li><li data-starts="2026-11-18T15:00:00Z">Two</li>
  <li data-starts="2026-11-19T15:00:00Z" hidden>Later</li>
</ol></div>
<ul><li data-day="mon">Mon</li><li data-day="wed">Wed</li></ul>
<!-- <li data-day="fri">a comment is no item</li> -->
<a class="btn" data-track="join_click" data-track-where="home-hero" href="/slack/">Join</a>
<template><button data-track="ask_used" data-track-where="home-ask">Ask</button></template>
<img src="/a.png" alt=""><br/><svg><path d="M0 0" /></svg>
</body></html>`;

const REGION = (clip, kinds) =>
  `<div class="region-art">${clip ? '<video data-region-clip muted loop></video>' : ""}<div data-hotspots>${kinds
    .map((k) => `<button data-hotspot="${k}">${k}</button>`)
    .join("")}</div></div>`;

const CANVAS = `<section data-canvas-picks><ul><li data-pick data-id="a">A</li><li data-pick data-id="b">B</li></ul></section>
<div class="canvas-full" data-canvas-full hidden><section><ul>${'<li data-resource data-id="r">R</li>'.repeat(30)}</ul></section></div>
<form data-newsletter data-submit-event="newsletter_submit"></form>`;

const SITEMAP_INDEX = `<?xml version="1.0"?><sitemapindex><sitemap><loc>${ORIGIN}/sitemap-0.xml</loc></sitemap></sitemapindex>`;
const SITEMAP_0 = `<?xml version="1.0"?><urlset><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/ecosystem-canvas/</loc></url><url><loc>https://other.example/</loc></url></urlset>`;

const ROUTES = {
  "/": HOME,
  "/agents/": '<ul><li data-agent="one" data-agent-head>One</li><li data-agent="two"><span data-agent-pic="two"></span></li></ul>',
  "/ecosystem-canvas/": CANVAS,
  "/regions/a/": REGION(true, ["companies", "event", "seat"]),
  "/regions/b/": REGION(true, ["companies"]),
  "/regions/c/": REGION(false, ["companies", "event"]),
  "/sitemap-index.xml": SITEMAP_INDEX,
  "/sitemap-0.xml": SITEMAP_0,
  "/slack/": { status: 302, location: "https://docs.example.com/forms/x" },
  "/join/": { status: 301, location: "/join/slack/" },
  "/join/slack/": "<form data-submit-event='join_submit'></form>",
  "/direct/": { status: 302, location: "https://join.slack.com/t/x" },
  "/broken/": { status: 503 },
  "/loop/": { status: 302, location: "/loop/" },
};

// ---------- a fake repo ----------

const root = mkdtempSync(join(tmpdir(), "engagement-collector-"));
after(() => rmSync(root, { recursive: true, force: true }));
const write = (rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
write("packages/shared/src/events.ts", 'export const EVENT_PROPS = {\n  join_click: ["where"],\n  ask_used: ["where"],\n  search_used: ["where"],\n  newsletter_submit: ["where"],\n  step_done: ["where"],\n} as const;\n');
write("site/src/lib/search.ts", 'track("search_used", { where, results });\n// track(name) is no call\n');
write("site/worker/mcp/server.ts", 'server.registerTool(\n    "search",\n  {});\nserver.registerTool("events", {});\nserver.registerTool("search", {});\nserver.registerPrompt("guide", {});\n');
write("site/public/art/hero.png", "binary.riv-free");
write("site/src/components/Keeper.astro", 'const src = "/art/rive/communitas.riv"; // and the rivets stay\n');
write("data/clients.yaml", "- id: claude\n  steps: [one, two]\n- id: code\n  command: x {url}\n- id: bare\n  name: No install yet\n");
write("data/brand.json", JSON.stringify({ places: [{ file: "a.jpg", builders: true }, { file: "b.jpg" }, { file: "c.jpg", builders: false }] }));
write("server.json", "{}");
write("data/notes/one.yaml", "a: 1\n");
write("data/notes/two.yml", "a: 2\n");
write("data/notes/readme.txt", "not counted\n");

// One targets entry per case: its id and its params.measure.
const def = (id, measure) => ({ id: `engagement.${id}`, params: { measure } });
const PARAMS = { origin: ORIGIN };
const run = (targets, { params = PARAMS, routes = ROUTES, calls } = {}) => collect({ root, params, targets, fetch: fakeSite(routes, calls), now: NOW });
const one = async (measure, opts) => (await run([def("x", measure)], opts))["engagement.x"];

// ---------- the HTML walk ----------

test("elements: hidden and template content is not shown, and script, comment and void tags do not confuse the walk", () => {
  const els = elements(HOME);
  const builders = els.filter((e) => e.attrs.has("data-builder"));
  assert.deepEqual(builders.map((e) => e.attrs.get("data-builder")), ["acme", "bolt", "acme"], "the < inside a script and a title starts no tag");
  const starts = els.filter((e) => e.attrs.has("data-starts"));
  assert.deepEqual(starts.map((e) => e.shown), [true, true, false]);
  assert.equal(els.filter((e) => e.attrs.has("data-day")).length, 2, "a commented-out item is no item");
  const ask = els.find((e) => e.attrs.get("data-track") === "ask_used");
  assert.equal(ask.shown, false, "a template's content is not shown");
  const join = els.find((e) => e.attrs.get("data-track") === "join_click");
  assert.equal(join.shown, true, "an img, a br and a self-closed path open nothing that hides the rest");
});

test("elements: content after a hidden element closes is shown again", () => {
  const els = elements('<div hidden><p data-x="1">a</p></div><p data-x="2">b</p><section><div hidden><span data-x="3"></span></section><i data-x="4"></i>');
  assert.deepEqual(els.filter((e) => e.attrs.has("data-x")).map((e) => [e.attrs.get("data-x"), e.shown]), [["1", false], ["2", true], ["3", false], ["4", true]]);
});

test("attributes, parseMark and the counts", () => {
  assert.deepEqual([...attributes(` data-a="x &amp; y" data-b='z' data-c=bare hidden`)], [["data-a", "x & y"], ["data-b", "z"], ["data-c", "bare"], ["hidden", ""]]);
  assert.deepEqual(parseMark("data-hotspot=event"), { attr: "data-hotspot", value: "event" });
  assert.deepEqual(parseMark("data-builder"), { attr: "data-builder", value: null });
  assert.deepEqual(countMarks(HOME, ["data-builder"], { distinct: true }), [{ mark: "data-builder", count: 2 }]);
  assert.deepEqual(countMarks(HOME, ["data-starts", "data-day"], { visible: true }).map((c) => c.count), [2, 2]);
  assert.deepEqual([...markValues(HOME, ["data-track"]).get("data-track")].sort(), ["ask_used", "join_click"]);
  assert.deepEqual(sitemapLocs(SITEMAP_0), [`${ORIGIN}/`, `${ORIGIN}/ecosystem-canvas/`, "https://other.example/"]);
});

// ---------- each read ----------

test("marks: distinct companies, items a visitor sees, and an exact attribute name", async () => {
  assert.equal(area, "engagement");
  const home = await one({ read: "marks", page: "/", marks: ["data-builder"], distinct: true });
  assert.equal(home.value, 2);
  assert.equal(home.read_at, NOW.toISOString());
  assert.match(home.source, /^state: the live page https:\/\/site\.example\/: elements carrying data-builder, each value once$/);
  const live = await one({ read: "marks", page: "/", marks: ["data-starts", "data-day"], visible: true, labels: { "data-starts": "events" } });
  assert.equal(live.value, 4);
  assert.deepEqual(live.detail, [{ label: "events", value: 2 }, { label: "data-day", value: 2 }]);
  const agents = await one({ read: "marks", page: "/agents/", marks: ["data-agent"], distinct: true });
  assert.equal(agents.value, 2, "data-agent-head and data-agent-pic are other attributes");
  const rows = await one({ read: "marks", page: "/ecosystem-canvas/", marks: ["data-pick", "data-resource"], visible: true });
  assert.equal(rows.value, 2, "the hidden full list adds no row");
});

test("pages: a page counts only when it carries every mark", async () => {
  const pages = ["/regions/a/", "/regions/b/", "/regions/c/"];
  const clips = await one({ read: "pages", pages, marks: ["data-region-clip"] });
  assert.equal(clips.value, 2);
  assert.deepEqual(clips.detail.map((d) => d.label), ["/regions/a/", "/regions/b/", "/regions/c/: no data-region-clip"]);
  const spots = await one({ read: "pages", pages, marks: ["data-hotspot=companies", "data-hotspot=event"] });
  assert.equal(spots.value, 2);
  assert.equal(spots.detail[1].label, "/regions/b/: no data-hotspot=event");
});

test("names: marked on a sitemap page or sent by a script; the rest are not wired", async () => {
  const calls = [];
  const got = await one(
    {
      read: "names",
      list: { file: "packages/shared/src/events.ts", pattern: "^  ([a-z_]+): \\[" },
      pages: "sitemap",
      marks: ["data-track", "data-submit-event"],
      calls: { paths: ["site/src"], pattern: "\\btrack\\(\\s*[\"']([a-z_]+)[\"']" },
    },
    { calls },
  );
  // join_click on home, ask_used in home's template, newsletter_submit on the canvas, search_used from a script.
  assert.equal(got.value, 4);
  assert.deepEqual(got.detail[0], { label: "step_done: not wired", value: 0, unit: "" });
  assert.ok(got.detail.some((d) => d.label === "search_used: sent from site/src/lib/search.ts"));
  assert.ok(got.detail.some((d) => d.label === "newsletter_submit: marked on 1 page"));
  assert.ok(!calls.some((c) => c.includes("other.example")), "a sitemap URL on another host is never fetched");
  assert.match(got.source, /every page in the sitemap \(2\)/);
});

test("names: a page that does not answer, or a list with no name, is not measured, never 0", async () => {
  const measure = { read: "names", list: { file: "packages/shared/src/events.ts", pattern: "^  ([a-z_]+): \\[" }, pages: ["/", "/broken/"], marks: ["data-track"] };
  const broken = await one(measure);
  assert.match(broken.could_not_check, /1 of 2 pages did not answer: GET \/broken\/ answered 503/);
  const none = await one({ ...measure, pages: ["/"], list: { file: "packages/shared/src/events.ts", pattern: "^NOPE ([a-z]+)" } });
  assert.match(none.could_not_check, /finds no name/);
  const gone = await one({ ...measure, pages: ["/"], list: { file: "packages/gone.ts", pattern: "(x)" } });
  assert.equal(gone.could_not_check, "packages/gone.ts is not in the repo");
  const noMap = await one({ ...measure, pages: "sitemap" }, { routes: { ...ROUTES, "/sitemap-index.xml": undefined } });
  assert.match(noMap.could_not_check, /sitemap: GET \/sitemap-index\.xml answered 404/);
});

test("source: distinct names in text files only", async () => {
  const tools = await one({ read: "source", paths: ["site/worker/mcp"], ext: [".ts"], pattern: "registerTool\\(\\s*[\"']([a-z_]+)[\"']" });
  assert.equal(tools.value, 2);
  assert.deepEqual(tools.detail.map((d) => d.label), ["search (site/worker/mcp/server.ts)", "events (site/worker/mcp/server.ts)"]);
  const rive = await one({ read: "source", paths: ["site/src", "site/public"], ext: [".astro", ".ts"], pattern: "([\\w./-]+\\.riv)\\b" });
  assert.equal(rive.value, 1, "rivets are no .riv file, and the png is not read");
  const gone = await one({ read: "source", paths: ["site/nope"], pattern: "x" });
  assert.equal(gone.could_not_check, "site/nope is not in the repo");
});

test("records: a share from YAML, a true field from JSON, and a missing file", async () => {
  const share = await one({ read: "records", file: "data/clients.yaml", has_any: ["command", "steps"], share: true });
  assert.equal(share.value, 66.7);
  assert.deepEqual(share.detail.map((d) => [d.label, d.value]), [["claude", 1], ["code", 1], ["bare", 0]]);
  const builders = await one({ read: "records", file: "data/brand.json", path: "places", where: "builders" });
  assert.equal(builders.value, 1, "only a field that is true counts");
  assert.match(builders.source, /3 records$/);
  const gone = await one({ read: "records", file: "data/none.yaml", share: true, has_any: ["x"] });
  assert.equal(gone.could_not_check, "data/none.yaml is not in the repo");
  const notList = await one({ read: "records", file: "data/brand.json", path: "nope" });
  assert.match(notList.could_not_check, /holds no list of records/);
});

test("files: a count by extension; a missing folder is 0 only when the entry says so", async () => {
  assert.equal((await one({ read: "files", dir: "data/notes", ext: [".yaml", ".yml"] })).value, 2);
  const zero = await one({ read: "files", dir: "data/spotlights", ext: [".yaml"], absent_is_zero: true });
  assert.equal(zero.value, 0);
  assert.equal(zero.detail[0].label, "data/spotlights is not in the repo yet");
  const typo = await one({ read: "files", dir: "data/spotlight", ext: [".yaml"] });
  assert.equal(typo.could_not_check, "data/spotlight is not in the repo");
});

test("listings: a file in the repo or a manual flag with its day", async () => {
  const got = await one({ read: "listings", items: [{ label: "Registry", file: "server.json" }, { label: "Directory", listed: false, set: "2026-11-16" }, { label: "Other", file: "other.json" }] });
  assert.equal(got.value, 1);
  assert.deepEqual(got.detail.map((d) => d.label), ["Registry: server.json is in the repo", "Directory: not listed (manual flag, set 2026-11-16)", "Other: other.json is not in the repo"]);
});

test("redirect: a form on another site is one step; the site's own page or Slack itself is none", async () => {
  const m = { read: "redirect", done_hosts: ["slack.com"] };
  const form = await one({ ...m, path: "/slack/" });
  assert.equal(form.value, 1);
  assert.equal(form.detail[0].label, "/slack/ answers 302 then docs.example.com, a page on another site");
  const own = await one({ ...m, path: "/join/" });
  assert.equal(own.value, 0);
  assert.equal(own.detail[0].label, "/join/ answers 301 then /join/slack/ on the site");
  assert.equal((await one({ ...m, path: "/direct/" })).value, 0, "join.slack.com is Slack itself");
  assert.equal((await one({ ...m, path: "/broken/" })).could_not_check, "GET /broken/ answered 503");
  assert.match((await one({ ...m, path: "/loop/" })).could_not_check, /more than 5 redirects/);
});

test("outside, no origin, no measure and a network failure are each not measured, never 0", async () => {
  const outside = await one({ read: "outside", reason: "needs a secret" });
  assert.equal(outside.could_not_check, "needs a secret");
  assert.equal(outside.value, undefined);
  const noOrigin = await one({ read: "marks", page: "/", marks: ["data-builder"] }, { params: {} });
  assert.equal(noOrigin.could_not_check, "params.origin names no site");
  const unknown = await one({ read: "guess" });
  assert.match(unknown.could_not_check, /is not one of marks, pages/);
  const bare = (await run([{ id: "engagement.bare" }]))["engagement.bare"];
  assert.match(bare.could_not_check, /has no params\.measure/);
  const down = await one({ read: "marks", page: "/", marks: ["data-builder"] }, { routes: { "/": new Error("ECONNRESET") } });
  assert.equal(down.could_not_check, "GET /: ECONNRESET");
  const away = await collect({
    root,
    params: PARAMS,
    targets: [def("x", { read: "marks", page: "/", marks: ["data-builder"] })],
    fetch: async () => Object.defineProperty(new Response("<p>"), "url", { value: "https://other.example/" }),
    now: NOW,
  });
  assert.equal(away["engagement.x"].could_not_check, "GET / left the site for other.example");
});

test("one fetch per page, however many metrics read it", async () => {
  const calls = [];
  await run([def("a", { read: "marks", page: "/", marks: ["data-builder"] }), def("b", { read: "marks", page: "/", marks: ["data-day"] })], { calls });
  assert.deepEqual(calls, ["follow /"]);
});

// ---------- the repo's own targets file ----------

test("this repo's targets: every entry is an Engagement metric with a goal source and a measure the collector knows", () => {
  const file = new URL("../../targets/engagement.json", import.meta.url);
  const targets = JSON.parse(readFileSync(file, "utf8"));
  const reads = new Set(["marks", "pages", "names", "source", "records", "files", "listings", "redirect", "outside"]);
  const ids = new Set();
  for (const t of targets) {
    assert.ok(t.id.startsWith("engagement."), t.id);
    assert.ok(!ids.has(t.id), `${t.id} twice`);
    ids.add(t.id);
    assert.equal(t.tab, "engagement", t.id);
    assert.ok(["quality", "speed", "consumption"].includes(t.kind), t.id);
    assert.ok(typeof t.goal === "number" && typeof t.near === "number", t.id);
    assert.ok(t.direction === "higher" ? t.near <= t.goal : t.near >= t.goal, `${t.id}: near on the worse side`);
    assert.ok(t.goal_source?.trim() && t.source?.trim(), t.id);
    assert.ok(!t.means || t.means.length <= 120, `${t.id}: means over 120 characters`);
    assert.ok(!t.group || t.group.length <= 30, `${t.id}: group over 30 characters`);
    assert.ok(reads.has(t.params?.measure?.read), `${t.id}: read ${t.params?.measure?.read}`);
    if (t.params.measure.read === "outside") assert.match(t.params.measure.reason, /^not measured yet: /, t.id);
    for (const text of [t.label, t.means, t.goal_source, t.source, t.params.measure.reason]) {
      assert.ok(!/[\u2013\u2014]/.test(text ?? ""), `${t.id}: a dash the writing rules refuse`);
    }
  }
  assert.equal(targets[0].params.origin, "https://coloradostartups.org");
});
