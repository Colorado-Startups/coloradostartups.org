// The MCP Apps cards (worker/mcp/ui/): the generated HTML, its tokens, its
// size and its isolation, the render functions as pure functions, and the
// hand-written postMessage bridge against a fake window.
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";

import {
  APP_PAD_PX,
  LABEL_PX,
  LABELS_MIN_VIEWPORT,
  MAP_MAX_PX,
  MAX_HTML_BYTES,
  MIN_LABEL_PX,
  renderCards,
  renderModule,
  TARGET,
  toPx,
} from "../../../scripts/build-mcp-ui.mjs";
import { inFrame, VIEWS } from "../../../src/lib/regions/colorado-views";
import { REGION_HTML, THIS_WEEK_HTML } from "../../../worker/mcp/ui/apps.generated";
import { APP_INFO, createBridge, PROTOCOL_VERSION, startCard, WAIT_MS } from "../../../worker/mcp/ui/bridge.mjs";
import {
  fallbackHtml,
  own,
  regionName,
  regionPage,
  renderRegion,
  renderWeek,
  safeUrl,
  toolData,
  WEEK_PAGE,
} from "../../../worker/mcp/ui/view.mjs";

const ROOT = path.resolve(__dirname, "../../../..");
const TOKENS = YAML.parse(readFileSync(path.join(ROOT, "01_doctrine/brand_tokens.yaml"), "utf8"));
const CARDS = { thisWeek: THIS_WEEK_HTML, region: REGION_HTML };
const NAMES = { "photon-mountain": "Photon Mountain", "space-peak": "Space Peak", "fusion-canyon": "Fusion Canyon" };

describe("generated cards", () => {
  // The generator runs by hand, not in the build: this test is what keeps its output current.
  const STALE = "site/worker/mcp/ui/apps.generated.ts is stale. Run: cd site && node scripts/build-mcp-ui.mjs";

  it("apps.generated.ts equals a fresh render of its sources", () => {
    expect(readFileSync(TARGET, "utf8"), STALE).toBe(renderModule());
    const fresh = renderCards();
    expect(THIS_WEEK_HTML, STALE).toBe(fresh.thisWeek);
    expect(REGION_HTML, STALE).toBe(fresh.region);
  });

  for (const [name, html] of Object.entries(CARDS)) {
    it(`${name}: one document under the cap, ASCII only`, () => {
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(Buffer.byteLength(html, "utf8")).toBeLessThan(MAX_HTML_BYTES);
      expect(/[^\x00-\x7f]/.test(html)).toBe(false);
    });

    it(`${name}: loads nothing from outside and fetches nothing`, () => {
      expect(html).not.toMatch(/\b(?:src|href|action|poster|srcset)\s*=\s*["']?\s*(?:https?:)?\/\//i);
      expect(html).not.toMatch(/url\(\s*["']?(?:https?:)?\/\//i);
      expect(html).not.toMatch(/@import|<link\b|<img\b|<iframe\b|<script\b[^>]*\bsrc\b/i);
      expect(html).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts/);
      // One inline script, with no attributes, and it parses. Any case, any closing-tag spacing.
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)];
      expect(scripts).toHaveLength(1);
      expect(scripts[0]![1]).toBe("");
      expect(() => new Function(scripts[0]![2]!)).not.toThrow();
    });

    it(`${name}: its colors and lengths are the brand tokens, light and night`, () => {
      const root = /:root\{color-scheme:light;([^}]*)\}/.exec(html)?.[1] ?? "";
      const vars = Object.fromEntries([...root.matchAll(/--([\w-]+):([^;]+);/g)].map((m) => [m[1], m[2]]));
      const colors = Object.entries(vars).filter(([k]) => k.startsWith("c-"));
      expect(colors.length).toBeGreaterThan(8);
      for (const [k, v] of colors) expect(v, k).toBe(TOKENS.color[k.slice(2)]);
      for (const [k, v] of Object.entries(vars).filter(([k]) => k.startsWith("s-"))) expect(v, k).toBe(TOKENS.space[k.slice(2)]);
      for (const [k, v] of Object.entries(vars).filter(([k]) => k.startsWith("r-"))) expect(v, k).toBe(TOKENS.radius[k.slice(2)]);
      const night = /:root\[data-theme="dark"\]\{color-scheme:dark;([^}]*)\}/.exec(html)?.[1] ?? "";
      const nightVars = [...night.matchAll(/--c-([\w-]+):([^;]+);/g)];
      expect(nightVars.length).toBeGreaterThan(4);
      for (const [, k, v] of nightVars) expect(v, k).toBe(TOKENS.night[k!]);
      // Every color the CSS names is one it defines.
      for (const [, used] of html.matchAll(/var\(--(c-[\w-]+)\)/g)) expect(vars, used).toHaveProperty(used!);
    });

    it(`${name}: no em dash, en dash, or place word the brand retired`, () => {
      expect(html).not.toMatch(/\u2014|\u2013|&mdash;|&ndash;/);
      expect(html).not.toMatch(/\b(?:Outpost|HQ|Hall)\b/);
    });
  }

  it("draws each region's map with the site's own projection", () => {
    for (const [lon, lat] of [[-105.27, 40.01], [-104.82, 38.83], [-105.08, 40.58]] as [number, number][]) {
      const [fx, fy] = inFrame(VIEWS.state, [lon, lat]);
      const [x, y] = toPx(VIEWS.state, [lon, lat]);
      expect(x).toBeCloseTo(fx * VIEWS.state.width, 6);
      expect(y).toBeCloseTo(fy * VIEWS.state.height, 6);
    }
    for (const id of Object.keys(NAMES)) expect(REGION_HTML).toContain(`Map of ${NAMES[id as keyof typeof NAMES]}`);
  });
});

const EVENTS = [
  {
    id: "ev-springs",
    title: "Space Pitch Night",
    start: "2026-11-18T18:30:00-07:00",
    end: "2026-11-18T20:00:00-07:00",
    allDay: false,
    location: "Colorado Springs",
    url: "https://example.org/pitch",
    inPerson: true,
    region: "space-peak",
  },
  {
    id: "ev-today",
    title: "Founder <Coffee> & \"chat\"",
    start: "2026-11-15T08:00:00-07:00",
    end: "2026-11-15T09:00:00-07:00",
    allDay: false,
    location: null,
    url: "javascript:alert(1)",
    inPerson: false,
    region: "elsewhere",
  },
  { id: "ev-day", title: "Demo Day", start: "2026-11-20", end: "2026-11-20", allDay: true, location: "Denver", url: null, inPerson: true, region: "photon-mountain" },
];
const CALENDAR = "https://coloradostartups.org/event-calendar/";
const WEEK = { from: "2026-11-15", to: "2026-11-21", timeZone: "America/Denver", region: null, events: EVENTS, calendar: CALENDAR };
const asResult = (data: unknown) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });

describe("renderWeek", () => {
  it("renders the week's events as cards, soonest first", () => {
    const html = renderWeek(toolData(asResult(WEEK)), NAMES);
    expect(html).toContain("<h1>This week</h1>");
    expect(html).toContain("Sun, Nov 15 to Sat, Nov 21, Mountain Time");
    const titles = [...html.matchAll(/<p class="title">(.*?)<\/p>/g)].map((m) => m[1]);
    expect(titles).toHaveLength(3);
    // Soonest first, whatever order the data came in.
    expect(titles[0]).toContain("Founder &lt;Coffee&gt; &amp; &quot;chat&quot;");
    expect(titles[1]).toContain("Space Pitch Night");
    expect(titles[2]).toContain("Demo Day");
    expect(html).toContain('<span class="day">Wed, Nov 18</span> <span class="time">6:30 pm</span>');
    expect(html).toContain('<span class="time">All day</span>');
    expect(html).toContain('<span>Online</span> <span class="tag">Elsewhere in Colorado</span>');
    expect(html).toContain('<span>Colorado Springs</span> <span class="tag">Space Peak</span>');
    // An event links its own https page; without one, or with a script URL, the calendar.
    expect(html).toContain('data-link="https://example.org/pitch"');
    expect(html).not.toContain("javascript:");
    expect(html.match(new RegExp(`data-link="${CALENDAR}"`, "g"))?.length).toBe(3);
    expect(html).toContain("Open data from Colorado Startups, CC BY 4.0");
  });

  it("names the region and the events past the first ten", () => {
    const html = renderWeek({ ...WEEK, region: "space-peak", moreEvents: 4 }, NAMES);
    expect(html).toContain("<h1>This week in Space Peak</h1>");
    expect(html).toContain(">4 more on the calendar</a>");
  });

  it("says so in one plain line, with the calendar, when the week is empty", () => {
    const html = renderWeek(toolData(asResult({ ...WEEK, events: [] })), NAMES);
    expect(html).toContain(`<p class="note">No events on the calendar this week. <a href="${CALENDAR}" data-link="${CALENDAR}"`);
    expect(html).not.toContain('class="cards"');
  });

  it("shows the fallback, with the calendar as text, for a result it cannot read", () => {
    const fallback = `<p class="note">This card could not load here. The same listing is at <span class="url">${WEEK_PAGE}</span>.</p>`;
    expect(WEEK_PAGE).toBe("coloradostartups.org/event-calendar/");
    expect(renderWeek(toolData({ isError: true, content: [{ type: "text", text: "{}" }] }), NAMES)).toBe(fallback);
    expect(renderWeek(toolData({ content: [{ type: "text", text: "not json" }] }), NAMES)).toBe(fallback);
  });

  it("skips null and incomplete entries, and shows the empty state when none are left", () => {
    const messy = { ...WEEK, events: [null, 7, "x", {}, { title: "No start" }, { start: "2026-11-16" }, { title: "Bad day", start: "soon" }, EVENTS[2]] };
    const html = renderWeek(messy, NAMES);
    expect([...html.matchAll(/<li class="ev">/g)]).toHaveLength(1);
    expect(html).toContain("Demo Day");
    const none = renderWeek({ ...WEEK, events: [null, {}, { title: "" }] }, NAMES);
    expect(none).toContain("No events on the calendar this week.");
    // Not an array at all: the empty state too, never a throw.
    for (const events of [null, "x", { a: 1 }, 3]) expect(renderWeek({ ...WEEK, events }, NAMES)).toContain("No events on the calendar this week.");
  });

  it("finds no region for a key from Object's prototype", () => {
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(regionName(key, NAMES)).toBe("Elsewhere in Colorado");
      expect(own(NAMES, key)).toBeNull();
      const html = renderWeek({ ...WEEK, region: key, events: [{ ...EVENTS[2], region: key }] }, NAMES);
      expect(html).toContain("<h1>This week</h1>");
      expect(html).toContain('<span class="tag">Elsewhere in Colorado</span>');
      expect(html).not.toContain("function");
    }
  });
});

describe("renderRegion", () => {
  const REGION = {
    id: "space-peak",
    name: "Space Peak",
    summary: "The region for Colorado Springs.",
    url: "https://coloradostartups.org/regions/space-peak/",
    cities: ["Colorado Springs", "Fountain"],
    nearby: [],
    counts: { resources: 1, companies: 1, upcomingEvents: 1 },
    resources: [],
    companies: [{ id: "peak-robotics", name: "Peak Robotics", city: "Boulder", sector: "Robotics", website: "https://example.org/peak" }],
    events: [EVENTS[0]],
  };
  const MAPS = { "space-peak": "<svg>map</svg>" };

  it("renders the name, cities, map, next events and companies, with links", () => {
    const html = renderRegion(toolData(asResult(REGION)), NAMES, MAPS);
    expect(html).toContain("<h1>Space Peak</h1>");
    expect(html).toContain('<p class="sub">Colorado Springs &#183; Fountain</p>');
    expect(html).toContain('<figure class="map"><svg>map</svg><figcaption>Space Peak in yellow; the corner map shows where it sits in Colorado.</figcaption></figure>');
    expect(html).toContain("Space Pitch Night");
    expect(html).toContain('data-link="https://coloradostartups.org/leaderboard/#company-peak-robotics"');
    expect(html).toContain('data-link="https://coloradostartups.org/regions/space-peak/"');
    expect(html).toContain(">Open the Space Peak page</a>");
    // No counts: the card shows listings, never how many.
    expect(html).not.toMatch(/\b1 (?:resource|compan|event)/);
  });

  it("links the calendar when the region has no events yet", () => {
    const html = renderRegion({ ...REGION, events: [] }, NAMES, MAPS);
    expect(html).toContain('data-link="https://coloradostartups.org/event-calendar/"');
    expect(html).toContain("No events on the calendar here yet.");
  });

  it("draws no map for an id it has no map for", () => {
    for (const id of ["__proto__", "constructor", "toString"]) expect(renderRegion({ ...REGION, id }, NAMES, MAPS)).not.toContain("<figure");
  });

  it("shows the fallback, with the region's page as text, for an error or non-JSON result", () => {
    const err = { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "No data for region space-peak" }) }] };
    expect(renderRegion(toolData(err), NAMES, MAPS, { id: "space-peak" })).toContain('<span class="url">coloradostartups.org/regions/space-peak/</span>');
    const junk = { content: [{ type: "text", text: "<html>oops" }] };
    expect(renderRegion(toolData(junk), NAMES, MAPS, { id: "constructor" })).toContain('<span class="url">coloradostartups.org/regions/</span>');
    expect(regionPage(null, NAMES)).toBe("coloradostartups.org/regions/");
  });

  it("skips null and incomplete events, companies and cities", () => {
    const messy = {
      ...REGION,
      cities: ["Colorado Springs", null, 4, ""],
      events: [null, { title: "x" }, "y", EVENTS[0]],
      companies: [null, { id: "a" }, { id: "b", name: "Bee Labs", sector: { bad: 1 }, city: 7 }],
    };
    const html = renderRegion(messy, NAMES, MAPS);
    expect(html).toContain('<p class="sub">Colorado Springs</p>');
    expect([...html.matchAll(/<li class="ev">/g)]).toHaveLength(1);
    expect(html).toContain(">Bee Labs</a></li>");
    expect(html).not.toContain("[object Object]");
    const none = renderRegion({ ...REGION, events: { length: 2 }, companies: "x", cities: null }, NAMES, MAPS);
    expect(none).toContain("No events on the calendar here yet.");
    expect(none).not.toContain("Leaderboard companies");
  });
});

describe("safeUrl and toolData", () => {
  it("keeps only well-formed https URLs", () => {
    expect(safeUrl("https://coloradostartups.org/a/")).toBe("https://coloradostartups.org/a/");
    for (const bad of ["http://x.org", "javascript:alert(1)", "https://x.org/\"onmouseover", " https://x.org", null, 3]) expect(safeUrl(bad)).toBeNull();
  });

  it("prefers structuredContent, then the JSON text", () => {
    expect(toolData({ structuredContent: { a: 1 }, content: [{ type: "text", text: '{"a":2}' }] })).toEqual({ a: 1 });
    expect(toolData({ content: [{ type: "text", text: '{"a":2}' }] })).toEqual({ a: 2 });
    expect(toolData({ content: [{ type: "text", text: "[1]" }] })).toBeNull();
  });
});

// A fake iframe window: what the View posts to its parent, and a way to post back.
function fakeWindow() {
  const sent: any[] = [];
  const listeners: ((e: { source: unknown; data: unknown }) => void)[] = [];
  const parent = { postMessage: (m: unknown, target: string) => sent.push({ m, target }) };
  const win = { parent, addEventListener: (_: string, fn: (e: { source: unknown; data: unknown }) => void) => listeners.push(fn) };
  const deliver = (data: unknown, source: unknown = parent) => listeners.forEach((fn) => fn({ source, data }));
  return { win, sent, deliver, parent };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("bridge", () => {
  it("runs the ui/initialize handshake, then sends initialized", async () => {
    const { win, sent, deliver } = fakeWindow();
    const contexts: unknown[] = [];
    const bridge = createBridge(win, { toolResult: () => {}, context: (c: unknown) => contexts.push(c) });
    const done = bridge.connect();
    expect(sent[0].m).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "ui/initialize",
      params: { appInfo: APP_INFO, appCapabilities: { availableDisplayModes: ["inline"] }, protocolVersion: PROTOCOL_VERSION },
    });
    deliver({ jsonrpc: "2.0", id: 1, result: { protocolVersion: PROTOCOL_VERSION, hostCapabilities: { openLinks: {} }, hostContext: { theme: "dark" } } });
    await done;
    expect(contexts).toEqual([{ theme: "dark" }]);
    expect(sent[1].m).toEqual({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
  });

  it("hands each tool result and context change to its handlers, from the parent only", () => {
    const { win, deliver } = fakeWindow();
    const results: unknown[] = [];
    const contexts: unknown[] = [];
    createBridge(win, { toolResult: (r: unknown) => results.push(r), context: (c: unknown) => contexts.push(c) });
    const result = { content: [{ type: "text", text: "{}" }] };
    deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result });
    deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [] } }, { other: true });
    deliver({ method: "ui/notifications/tool-result", params: {} });
    deliver({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme: "light" } });
    expect(results).toEqual([result]);
    expect(contexts).toEqual([{ theme: "light" }]);
  });

  it("answers teardown and ping, and refuses other host requests", () => {
    const { win, sent, deliver } = fakeWindow();
    createBridge(win, { toolResult: () => {}, context: () => {} });
    deliver({ jsonrpc: "2.0", id: 7, method: "ui/resource-teardown", params: { reason: "done" } });
    deliver({ jsonrpc: "2.0", id: 8, method: "ping" });
    deliver({ jsonrpc: "2.0", id: 9, method: "tools/call", params: {} });
    expect(sent.map((s) => s.m)).toEqual([
      { jsonrpc: "2.0", id: 7, result: {} },
      { jsonrpc: "2.0", id: 8, result: {} },
      { jsonrpc: "2.0", id: 9, error: { code: -32601, message: "Method not found" } },
    ]);
  });

  it("opens an https link through ui/open-link only when the host offers it", async () => {
    const { win, sent, deliver } = fakeWindow();
    const bridge = createBridge(win, { toolResult: () => {}, context: () => {} });
    expect(await bridge.openLink("https://coloradostartups.org/")).toBe(false);
    const done = bridge.connect();
    deliver({ jsonrpc: "2.0", id: 1, result: { hostCapabilities: { openLinks: {} }, hostContext: {} } });
    await done;
    expect(await bridge.openLink("javascript:alert(1)")).toBe(false);
    const opening = bridge.openLink("https://coloradostartups.org/regions/");
    await tick();
    const req = sent.map((s) => s.m).find((m) => m.method === "ui/open-link");
    expect(req.params).toEqual({ url: "https://coloradostartups.org/regions/" });
    deliver({ jsonrpc: "2.0", id: req.id, result: {} });
    expect(await opening).toBe(true);
  });

  it("reports its size as ui/notifications/size-changed", () => {
    const { win, sent } = fakeWindow();
    createBridge(win, { toolResult: () => {}, context: () => {} }).reportSize(480, 312);
    expect(sent[0].m).toEqual({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { width: 480, height: 312 } });
  });
});

// A fake card page: the window above with timers, and the few DOM parts startCard touches.
function fakeCard() {
  const w = fakeWindow();
  const app = { innerHTML: '<p class="note">Loading</p>', addEventListener: () => {} };
  const el = { style: { height: "" }, getBoundingClientRect: () => ({ height: 100 }), setAttribute: () => {} };
  const doc = { getElementById: () => app, documentElement: el, body: { style: {} } };
  const win = Object.assign(w.win, { innerWidth: 400, setTimeout, clearTimeout, open: () => {} });
  return { ...w, win, doc, app };
}
const WEEK_RESULT = { content: [{ type: "text", text: JSON.stringify(WEEK) }] };
const weekCard = (c: ReturnType<typeof fakeCard>) =>
  startCard(c.win, c.doc, (r: unknown) => renderWeek(toolData(r), NAMES), () => fallbackHtml(WEEK_PAGE));

describe("startCard", () => {
  afterEach(() => vi.useRealTimers());

  it("shows the fallback when the host never answers ui/initialize", async () => {
    vi.useFakeTimers();
    const c = fakeCard();
    weekCard(c);
    await vi.advanceTimersByTimeAsync(WAIT_MS - 1);
    expect(c.app.innerHTML).toContain("Loading");
    await vi.advanceTimersByTimeAsync(1);
    expect(c.app.innerHTML).toBe(fallbackHtml(WEEK_PAGE));
    expect(c.app.innerHTML).toContain("coloradostartups.org/event-calendar/");
  });

  it("shows the fallback when the handshake ends but no tool result follows", async () => {
    vi.useFakeTimers();
    const c = fakeCard();
    weekCard(c);
    await vi.advanceTimersByTimeAsync(WAIT_MS - 1000);
    c.deliver({ jsonrpc: "2.0", id: 1, result: { hostCapabilities: {}, hostContext: {} } });
    await vi.advanceTimersByTimeAsync(WAIT_MS - 1);
    expect(c.app.innerHTML).toContain("Loading");
    await vi.advanceTimersByTimeAsync(1);
    expect(c.app.innerHTML).toBe(fallbackHtml(WEEK_PAGE));
  });

  it("renders a result that arrives after the fallback", async () => {
    vi.useFakeTimers();
    const c = fakeCard();
    weekCard(c);
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect(c.app.innerHTML).toBe(fallbackHtml(WEEK_PAGE));
    c.deliver({ jsonrpc: "2.0", id: 1, result: { hostCapabilities: {}, hostContext: {} } });
    c.deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: WEEK_RESULT });
    expect(c.app.innerHTML).toContain("<h1>This week</h1>");
    // And no later timer puts the fallback back.
    await vi.advanceTimersByTimeAsync(WAIT_MS * 3);
    expect(c.app.innerHTML).toContain("<h1>This week</h1>");
  });

  it("shows the fallback when render throws, never Loading", () => {
    const c = fakeCard();
    startCard(c.win, c.doc, () => {
      throw new Error("shape");
    }, () => "FALLBACK");
    c.deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [] } });
    expect(c.app.innerHTML).toBe("FALLBACK");
  });

  it("names the region's page in the fallback from the tool input", async () => {
    vi.useFakeTimers();
    const c = fakeCard();
    startCard(c.win, c.doc, (r: unknown, input: unknown) => renderRegion(toolData(r), NAMES, {}, input), (input: unknown) =>
      fallbackHtml(regionPage(input, NAMES)),
    );
    c.deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { id: "fusion-canyon" } } });
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect(c.app.innerHTML).toContain('<span class="url">coloradostartups.org/regions/fusion-canyon/</span>');
    // A non-JSON result after that keeps the fallback, with the same page.
    c.deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [{ type: "text", text: "nope" }] } });
    expect(c.app.innerHTML).toContain("coloradostartups.org/regions/fusion-canyon/");
  });
});

describe("map labels", () => {
  // The map's drawn width at a viewport width: the card's padding and border off, up to the cap.
  const drawn = (viewport: number) => Math.min(MAP_MAX_PX, viewport - 2 * APP_PAD_PX - 2);
  const labelPx = (viewport: number) => (LABEL_PX * drawn(viewport)) / VIEWS["zone-space-peak"].width;

  it("are 12 px or more wherever they show, and hidden below that width", () => {
    expect(MIN_LABEL_PX).toBe(12);
    expect(APP_PAD_PX).toBe(Number.parseInt(TOKENS.space["4"], 10));
    for (const id of Object.keys(NAMES)) expect(VIEWS[`zone-${id}` as keyof typeof VIEWS].width).toBe(VIEWS["zone-space-peak"].width);
    for (let vw = LABELS_MIN_VIEWPORT; vw <= 1200; vw += 4) expect(labelPx(vw), `${vw}px`).toBeGreaterThanOrEqual(MIN_LABEL_PX);
    // At 320 px they would be about 11 px, so the CSS hides them there.
    expect(labelPx(320)).toBeLessThan(MIN_LABEL_PX);
    expect(REGION_HTML).toContain(`.map text{font:600 ${LABEL_PX}px`);
    expect(REGION_HTML).toContain(`@media (max-width:${LABELS_MIN_VIEWPORT - 0.02}px){.map text{display:none}}`);
    expect(REGION_HTML).toContain(`max-width:${MAP_MAX_PX}px`);
    expect(REGION_HTML).toContain(`#app{padding:${APP_PAD_PX}px`);
  });
});
