import { expect, test, type Browser } from "@playwright/test";

// L5a: mobile CLS on /, /ecosystem-canvas/ and /regions/ stays at 0.1 or less
// (card "Cut mobile CLS", web.dev/articles/cls). The Quality page's lab read
// / at 0.12 and /ecosystem-canvas/ at 0.23 (2026-11-04). This loads each page
// the way that lab does: Lighthouse's mobile settings through CDP (Code-OS
// quality/collectors/site-lib.mjs, LAB). A failure names each shift and the
// elements that moved; the log also carries each load's LCP and bytes.

const LAB = {
  viewport: { width: 412, height: 823 },
  deviceScaleFactor: 1.75,
  cpuSlowdown: 4,
  latencyMs: 150 * 3.75,
  downloadKbps: 1.6 * 1024 * 0.9,
  uploadKbps: 750 * 0.9,
};
const GOAL = 0.1;
const SETTLE_MS = 3000;

interface Shift {
  startTime: number;
  value: number;
  hadRecentInput: boolean;
  sources: string[];
  /** The layout viewport's width and the page's scroll width, in CSS px. */
  widths: string;
  /** Web fonts loaded by then. */
  fonts: string;
}

// Runs in the page before any of its scripts: keeps every layout shift, with
// the element and the move of each source.
function observeShifts() {
  const shifts: Shift[] = [];
  const name = (n: Node | null) => {
    if (!(n instanceof Element)) return n?.nodeName ?? "?";
    const cls = [...n.classList].slice(0, 2).map((c) => `.${c}`).join("");
    return `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ""}${cls}`;
  };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as (PerformanceEntry & {
      value: number;
      hadRecentInput: boolean;
      sources: { node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[];
    })[]) {
      shifts.push({
        startTime: Math.round(e.startTime),
        value: e.value,
        hadRecentInput: e.hadRecentInput,
        sources: e.sources.map((s) => {
          const [a, b] = [s.previousRect, s.currentRect].map((r) => `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`);
          return `${name(s.node)} ${a} → ${b}`;
        }),
        widths: `viewport ${document.documentElement.clientWidth}, scroll ${document.documentElement.scrollWidth}`,
        fonts: [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight}`).join(", ") || "none",
      });
    }
  }).observe({ type: "layout-shift", buffered: true });
  Object.defineProperty(window, "__shifts", { value: shifts });
}

// The largest session window (web-vitals 5). Shifts Chrome flags as after
// input before the first unflagged one still count, as the lab counts them
// (crbug.com/1302667; site-lib.mjs labShifts).
function cls(shifts: Shift[]): number {
  let respect = false;
  let max = 0;
  let value = 0;
  let first = 0;
  let last = 0;
  for (const s of [...shifts].sort((a, b) => a.startTime - b.startTime)) {
    if (!s.hadRecentInput) respect = true;
    if (s.hadRecentInput && respect) continue;
    if (value && s.startTime - last < 1000 && s.startTime - first < 5000) {
      value += s.value;
    } else {
      value = s.value;
      first = s.startTime;
    }
    last = s.startTime;
    max = Math.max(max, value);
  }
  return max;
}

// Runs in the page before any of its scripts: keeps each largest-contentful-
// paint candidate. LCP is the last one (web-vitals 5 onLCP; site-lib.mjs).
function observeLcp() {
  const lcp: number[] = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) lcp.push(e.startTime);
  }).observe({ type: "largest-contentful-paint", buffered: true });
  Object.defineProperty(window, "__lcp", { value: lcp });
}

interface Load {
  shifts: Shift[];
  /** Largest contentful paint, ms from navigation start. */
  lcp: number;
  /** Every response's bytes on the wire, headers included. */
  bytes: number;
}

// One cold load of `path` under the lab's settings.
async function labLoad(browser: Browser, path: string): Promise<Load> {
  const context = await browser.newContext({
    viewport: LAB.viewport,
    deviceScaleFactor: LAB.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    const sizes: Promise<number>[] = [];
    page.on("requestfinished", (r) => sizes.push(r.sizes().then((s) => s.responseBodySize + s.responseHeadersSize)));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: LAB.latencyMs,
      downloadThroughput: Math.floor((LAB.downloadKbps * 1024) / 8),
      uploadThroughput: Math.floor((LAB.uploadKbps * 1024) / 8),
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: LAB.cpuSlowdown });
    await page.addInitScript(observeShifts);
    await page.addInitScript(observeLcp);
    await page.goto(path, { waitUntil: "load", timeout: 90_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    // Awaited here, so the finally block closes the context only after the read.
    const { shifts, lcp } = await page.evaluate(() => {
      const w = window as unknown as { __shifts: Shift[]; __lcp: number[] };
      return { shifts: w.__shifts, lcp: w.__lcp.at(-1) ?? 0 };
    });
    const bytes = (await Promise.all(sizes)).reduce((a, b) => a + b, 0);
    return { shifts, lcp: Math.round(lcp), bytes };
  } finally {
    await context.close();
  }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

// Three cold loads per page; the median meets the goal, so one noisy load
// neither fails nor passes a page. Each load's CLS, LCP and bytes are logged.
const RUNS = 3;

test.describe("mobile layout shift, lab settings", () => {
  test.describe.configure({ timeout: 240_000 });

  for (const path of ["/", "/ecosystem-canvas/", "/regions/"]) {
    test(`${path} keeps CLS at ${GOAL} or less`, async ({ browser }) => {
      const loads: Load[] = [];
      for (let i = 0; i < RUNS; i++) loads.push(await labLoad(browser, path));
      const values = loads.map((l) => cls(l.shifts));
      const reports = loads.map((l, i) =>
        [
          `load ${i + 1}: CLS ${values[i]!.toFixed(4)}, LCP ${l.lcp} ms, ${l.bytes} bytes`,
          ...l.shifts.map(
            (s) => `  ${s.startTime} ms +${s.value.toFixed(4)}${s.hadRecentInput ? " (input)" : ""} [${s.widths}; fonts: ${s.fonts}]: ${s.sources.join("; ")}`,
          ),
        ].join("\n"),
      );
      const summary = `${path} CLS ${median(values).toFixed(4)}, LCP ${median(loads.map((l) => l.lcp))} ms, ${median(loads.map((l) => l.bytes))} bytes (medians of ${RUNS})`;
      // Printed on a pass too, so a run's log shows each page's margin.
      console.log(`${summary}\n${reports.join("\n")}`);
      expect(median(values), `${summary}\n${reports.join("\n")}`).toBeLessThanOrEqual(GOAL);
    });
  }
});

// The bytes the provenance record adds to one WebP: its XMP chunk, and the
// VP8X header a simple lossy file gains for it. A file with alpha or
// animation has a VP8X header already. Null when it carries no XMP.
function provenanceBytes(webp: Buffer): number | null {
  const ids: string[] = [];
  let xmp: number | null = null;
  for (let at = 12; at + 8 <= webp.length; ) {
    const id = webp.toString("ascii", at, at + 4);
    const size = webp.readUInt32LE(at + 4);
    ids.push(id);
    if (id === "XMP ") xmp = 8 + size + (size % 2);
    at += 8 + size + (size % 2);
  }
  if (xmp === null) return null;
  return xmp + (ids.includes("ALPH") || ids.includes("ANIM") ? 0 : 18);
}

// Card "Served art keeps its provenance XMP" (#668): a visitor's copy of each
// Hall picture carries its record. Phone size, no throttle; every lazy
// picture is loaded, so the byte count is the whole page's.
test.describe("served art carries its provenance", () => {
  for (const path of ["/", "/regions/", "/team/"]) {
    test(`${path} art images carry their XMP record`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: LAB.viewport, deviceScaleFactor: LAB.deviceScaleFactor, isMobile: true, hasTouch: true });
      try {
        const page = await context.newPage();
        const bodies = new Map<string, Promise<Buffer>>();
        page.on("response", (r) => {
          if (r.url().endsWith(".webp")) bodies.set(r.url(), r.body());
        });
        await page.goto(path);
        await page.locator(".art-frame img").evaluateAll((imgs) => imgs.forEach((i) => ((i as HTMLImageElement).loading = "eager")));
        await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".art-frame img")].every((i) => i.complete));
        const urls = await page.locator(".art-frame img").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).currentSrc));
        expect(urls.length).toBeGreaterThan(0);
        let total = 0;
        let added = 0;
        for (const url of urls) {
          const body = await bodies.get(url);
          expect(body, url).toBeDefined();
          const bytes = provenanceBytes(body!);
          expect(bytes, `${url} carries no XMP`).not.toBeNull();
          total += body!.length;
          added += bytes!;
        }
        console.log(`${path} art: ${urls.length} pictures, ${total} bytes, provenance adds ${added} bytes`);
      } finally {
        await context.close();
      }
    });
  }
});

// What a web-font swap would move (#762). The CLS loads above only see a swap
// when the fonts land after first paint, which depends on the network: the
// local server sends the HTML uncompressed, so the fonts often beat the first
// paint here and a bad fallback hides (production read 0.12 on /leaderboard/
// while this lab read 0). So each page loads twice at the lab's phone size,
// once with the web fonts blocked (the fallback a slow first visit paints) and
// once with them loaded, and the first screen's boxes are compared.

interface Box {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Sections too: their bands are most of the area a real shift moves.
const SWAP_SELECTOR = "section, h1, h2, h3, p, li, .btn, button, figure, input, select, textarea, table";

async function firstScreenBoxes(browser: Browser, path: string, blockFonts: boolean): Promise<Box[]> {
  const context = await browser.newContext({ viewport: LAB.viewport, deviceScaleFactor: LAB.deviceScaleFactor, isMobile: true, hasTouch: true });
  try {
    if (blockFonts) await context.route(/\/_astro\/fonts\/.+\.woff2$/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(path, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    // Every box in document order, so the two loads line up index by index.
    return await page.evaluate((selector) => {
      return [...document.querySelectorAll(selector)].map((el) => {
        const r = el.getBoundingClientRect();
        const cls = [...el.classList].slice(0, 2).map((c) => `.${c}`).join("");
        return { name: `${el.tagName.toLowerCase()}${cls}`, x: r.x, y: r.y, width: r.width, height: r.height };
      });
    }, SWAP_SELECTOR);
  } finally {
    await context.close();
  }
}

// One frame's layout-shift score for the boxes that moved, the way Chrome
// scores it (web.dev/articles/cls): the share of the viewport the moved boxes
// cover before or after, times the largest move over the viewport's larger
// side. The cover is counted on a 4 px grid, so nested boxes count once.
function swapScore(fallback: Box[], loaded: Box[]): { score: number; movers: string[] } {
  const { width: vw, height: vh } = LAB.viewport;
  const CELL = 4;
  const cols = Math.ceil(vw / CELL);
  const covered = new Set<number>();
  let distance = 0;
  const movers: string[] = [];
  const mark = (b: Box) => {
    for (let y = Math.max(0, b.y); y < Math.min(vh, b.y + b.height); y += CELL) {
      for (let x = Math.max(0, b.x); x < Math.min(vw, b.x + b.width); x += CELL) covered.add(Math.floor(y / CELL) * cols + Math.floor(x / CELL));
    }
  };
  fallback.forEach((a, i) => {
    const b = loaded[i];
    if (!b || b.name !== a.name) return;
    const inView = (box: Box) => box.y < vh && box.y + box.height > 0;
    const move = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    if (move < 1 || !(inView(a) || inView(b))) return;
    mark(a);
    mark(b);
    distance = Math.max(distance, move);
    movers.push(`${a.name} ${Math.round(a.x)},${Math.round(a.y)} → ${Math.round(b.x)},${Math.round(b.y)}`);
  });
  const impact = covered.size / (cols * Math.ceil(vh / CELL));
  return { score: impact * (distance / Math.max(vw, vh)), movers };
}

test.describe("a web-font swap moves the first screen by no more than the CLS goal", () => {
  test("the score reads a move (self-test)", () => {
    const box = (y: number): Box => ({ name: "p", x: 0, y, width: 412, height: 100 });
    expect(swapScore([box(0)], [box(0)]).score).toBe(0);
    expect(swapScore([box(400)], [box(460)]).score).toBeGreaterThan(0.01);
  });

  for (const path of ["/", "/leaderboard/", "/regions/", "/ecosystem-canvas/", "/team/", "/get-involved/"]) {
    test(`${path} at the lab's phone size`, async ({ browser }) => {
      const fallback = await firstScreenBoxes(browser, path, true);
      const loaded = await firstScreenBoxes(browser, path, false);
      expect(loaded.length).toBe(fallback.length);
      const { score, movers } = swapScore(fallback, loaded);
      const report = `${path} swap score ${score.toFixed(4)}; moved: ${movers.slice(0, 8).join("; ") || "none"}`;
      console.log(report);
      expect(score, report).toBeLessThanOrEqual(GOAL);
    });
  }
});

// Each fallback face draws text about as wide as the Alegreya face it stands
// in for, in every weight and style the site loads (#762, and its italic
// follow-up). One sample sentence per face, measured with the web fonts
// blocked and loaded. Average-width sizing lands the regular and medium faces
// within 4 percent here, but Chrome draws the bold ones 4 to 9 percent off
// (glyph advances alone say 2), so the bound is 10 percent: it catches a
// missing or misfiled face, as main's italic was (13 percent wide at 400).
const SAMPLE = "Founders building companies in Colorado find programs, investors and each other here.";

async function sampleWidths(browser: Browser, blockFonts: boolean): Promise<{ widths: Record<string, number>; faces: string }> {
  const context = await browser.newContext({ viewport: LAB.viewport, deviceScaleFactor: LAB.deviceScaleFactor });
  try {
    if (blockFonts) await context.route(/\/_astro\/fonts\/.+\.woff2$/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto("/");
    return await page.evaluate(async (sample) => {
      const family = getComputedStyle(document.documentElement).getPropertyValue("--font-body").split(",")[0]!.trim();
      const spans: [string, HTMLSpanElement][] = [];
      for (const weight of [400, 500, 700]) {
        for (const style of ["normal", "italic"]) {
          // A blocked file rejects; the fallback then draws, which is the point.
          await document.fonts.load(`${style} ${weight} 18px ${family}`).catch(() => []);
          const span = document.createElement("span");
          span.textContent = sample;
          span.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;font-family:var(--font-body);font-size:18px;font-weight:${weight};font-style:${style}`;
          document.body.append(span);
          spans.push([`${weight} ${style}`, span]);
        }
      }
      // Laying the spans out starts their local() fallback loads; measure only
      // once those have settled, or a face still loading draws as another font.
      for (const [, span] of spans) span.getBoundingClientRect();
      await document.fonts.ready;
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      // Which fallback faces drew: a local() font the system lacks reads "error".
      const faces = [...document.fonts]
        .filter((f) => f.family.includes("Fallback"))
        .map((f) => `${f.family.replace(/"/g, "")} ${f.weight} ${f.style}: ${f.status}`)
        .join("; ");
      return { widths: Object.fromEntries(spans.map(([key, span]) => [key, span.getBoundingClientRect().width])), faces };
    }, SAMPLE);
  } finally {
    await context.close();
  }
}

test("each body fallback face draws within 10 percent of Alegreya's width", async ({ browser }) => {
  const { widths: fallback, faces } = await sampleWidths(browser, true);
  const { widths: loaded } = await sampleWidths(browser, false);
  const ratios = Object.keys(loaded).map((key) => [key, fallback[key]! / loaded[key]!] as const);
  const report = `${ratios.map(([key, r]) => `${key} ${r.toFixed(3)}`).join(", ")} (faces: ${faces})`;
  console.log(`fallback / Alegreya width: ${report}`);
  for (const [key, r] of ratios) expect(Math.abs(r - 1), `${key}: ${report}`).toBeLessThanOrEqual(0.1);
});
