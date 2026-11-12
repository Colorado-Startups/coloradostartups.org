// L38 over the built site (run `npm run build` first; test:content does):
// the four volunteer seat pages at /get-involved/<seat id>/ keep the kit
// owner's rules, and /get-involved/ links each seat to its page.
//
//   1  the status line: "An unpaid volunteer role." (decision 67)
//   2  no banned word in visible text; costs are "reimbursed"
//   3  Communitas is an AI agent in every sentence that names it, and no
//      sentence shows a keeper moderating
//   4  every figure is a fact in facts.yaml with its footnote, and facts that
//      share a source share one footnote
//   5  maps carry no numbers
//   6  diagrams show helpers, never investors
//   7  step 3 promises an interview only if it looks like a fit
//   8  the hero button jumps to #how-to-apply; the apply link is exact
// Each matcher runs on a known-bad and a known-clean sample before it runs on
// the pages.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { UNPAID_VOLUNTEER_LINE } from "../../../src/components/positions/positions";
import { axeViolations } from "../l9/axe";
import { readDist, SITE_DIR, sitemapPaths } from "../pages";

interface Fact {
  value: string;
  label: string;
  source: string;
  url: string;
  read: string;
  short: string;
  bar?: string;
}

const DATA = path.resolve(SITE_DIR, "..", "data", "positions");
const facts = parse(readFileSync(path.join(DATA, "facts.yaml"), "utf8")) as Record<string, Fact>;
const common = parse(readFileSync(path.join(DATA, "common.yaml"), "utf8")) as {
  org: { lead: string };
  courses: Record<string, { title: string; url: string }>;
  steps: { title: string; body: string }[];
};
const SEATS = ["slack-community-lead", "photon-mountain-connector", "space-peak-connector", "fusion-canyon-connector"];
const titleOf = (id: string) => (parse(readFileSync(path.join(DATA, `${id}.yaml`), "utf8")) as { title: string }).title;

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// ---- Matchers ------------------------------------------------------------------------------

/** Decision 67's banned words, whole words, any case. "Unpaid" and "reimbursed" pass. */
const BANNED = /\b(?:paid|pays?|salar(?:y|ies)|stipends?|hiring|hires?|hired|jobs?|contributors?)\b/i;

const SENTENCE = /(?<=[.!?])\s+/;
const BLOCK = "p, li, h1, h2, h3, h4, h5, h6, figcaption, td, th, caption, dt, dd, title, desc, text, span, strong, a, div";

/** Sentences that name a keeper and do not say "AI agent", or that show a keeper moderating. */
function keeperProblems(page: Document | Element): string[] {
  const problems: string[] = [];
  const sentences = new Set<string>();
  const root = "body" in page ? page.body : page;
  for (const el of [root, ...root.querySelectorAll("*")]) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join("");
    if (/Communitas|Resourcus|Publicus/.test(own)) {
      const block = el.closest(BLOCK) ?? el;
      for (const s of text(block).split(SENTENCE)) sentences.add(s);
    }
    for (const attr of ["alt", "aria-label", "title"]) {
      const value = el.getAttribute(attr);
      if (value && /Communitas|Resourcus|Publicus/.test(value)) for (const s of value.split(SENTENCE)) sentences.add(s);
    }
  }
  for (const s of sentences) {
    if (!/Communitas|Resourcus|Publicus/.test(s)) continue;
    if (!/\bAI agents?\b/i.test(s)) problems.push(`no disclosure: "${s}"`);
    if (/\bmoderat/i.test(s) && !/\bnever\b/i.test(s)) problems.push(`keeper moderating: "${s}"`);
  }
  return problems;
}

/** Text inside <main> with a digit that is not a footnoted fact, a footnoted course length or a step ordinal. */
function strayFigures(main: Element): string[] {
  const out: string[] = [];
  const walker = main.ownerDocument.createTreeWalker(main, 4);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const value = n.textContent ?? "";
    if (!/\d/.test(value)) continue;
    const el = n.parentElement!;
    if (el.closest("[data-sources]")) continue;
    if (el.closest("[data-ordinal]")) continue;
    const holder = el.closest("[data-fact], [data-course], [data-course-total]");
    if (!holder || !holder.querySelector("a.seat-fn[href^='#source-']")) out.push(value.trim());
  }
  return out;
}

/** The Sources entry a footnote marker points to. */
function sourceFor(page: Document, marker: Element | null): Element | null {
  const href = marker?.getAttribute("href") ?? "";
  return href.startsWith("#") ? page.getElementById(href.slice(1)) : null;
}

describe("the matchers (self-tests)", () => {
  it("BANNED catches each banned word (known bad) and passes unpaid and reimbursed (known clean)", () => {
    for (const bad of ["a paid role", "We are hiring", "Hire a lead", "This job", "Pay is weekly", "A salary", "No stipend", "Every contributor"]) {
      expect(bad).toMatch(BANNED);
    }
    expect("An unpaid volunteer role. Coffees reimbursed against receipts. Employees welcome.").not.toMatch(BANNED);
  });

  it("keeperProblems flags a bare keeper and a moderating keeper (known bad) and passes disclosed ones (known clean)", () => {
    const bad = doc("<p>Communitas greets you.</p><p>Communitas, an AI agent, moderates the Slack.</p>");
    expect(keeperProblems(bad)).toEqual([
      'no disclosure: "Communitas greets you."',
      'keeper moderating: "Communitas, an AI agent, moderates the Slack."',
    ]);
    const clean = doc('<p>People moderate. Communitas, an AI agent, never does.</p><img alt="Communitas, Keeper of the Doors: an AI agent.">');
    expect(keeperProblems(clean)).toEqual([]);
  });

  it("strayFigures flags a bare number (known bad) and passes a footnoted fact (known clean)", () => {
    const bad = doc("<main><p>Over 4,000 founders</p></main>").querySelector("main")!;
    expect(strayFigures(bad)).toEqual(["Over 4,000 founders"]);
    const clean = doc('<main><div data-fact="x"><span>82%</span><a class="seat-fn" href="#source-1">1</a></div></main>').querySelector("main")!;
    expect(strayFigures(clean)).toEqual([]);
  });
});

// ---- The four pages ------------------------------------------------------------------------

describe.each(SEATS)("/get-involved/%s/", (id) => {
  const source = readDist(`get-involved/${id}/index.html`);
  const page = doc(source);
  const main = page.querySelector("main")!;
  const title = titleOf(id);

  it("leads with the seat title and says the unpaid volunteer line once, in the hero (rule 1)", () => {
    expect(UNPAID_VOLUNTEER_LINE).toBe("An unpaid volunteer role.");
    expect(text(main.querySelector("h1"))).toBe(title);
    expect(count(text(main), UNPAID_VOLUNTEER_LINE)).toBe(1);
    expect(text(page.querySelector("[data-seat-hero] [data-unpaid-line]"))).toBe(UNPAID_VOLUNTEER_LINE);
  });

  it("has no banned word anywhere a reader sees, head included (rule 2)", () => {
    expect(text(page.body)).not.toMatch(BANNED);
    expect(text(page.querySelector("title"))).not.toMatch(BANNED);
    for (const meta of page.querySelectorAll("meta[content]")) expect(meta.getAttribute("content") ?? "").not.toMatch(BANNED);
    for (const el of page.querySelectorAll("[alt], [aria-label]")) {
      expect(`${el.getAttribute("alt") ?? ""} ${el.getAttribute("aria-label") ?? ""}`).not.toMatch(BANNED);
    }
  });

  it("calls every keeper it names an AI agent, in that sentence, and shows none moderating (rule 3)", () => {
    expect(keeperProblems(page)).toEqual([]);
  });

  it("shows only figures from facts.yaml, each with its value and its footnote (rule 4)", () => {
    expect(strayFigures(main)).toEqual([]);
    const shown = [...main.querySelectorAll<HTMLElement>("[data-fact]")];
    expect(shown.length).toBeGreaterThan(0);
    for (const el of shown) {
      const fact = facts[el.dataset.fact!];
      expect(fact, el.dataset.fact).toBeDefined();
      expect(text(el.querySelector("[data-value]"))).toBe(fact!.value);
      const entry = sourceFor(page, el.querySelector("a.seat-fn"));
      expect(entry, el.dataset.fact).not.toBeNull();
      expect([...entry!.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toContain(fact!.url);
      expect(text(entry!.querySelector(`[data-source-fact='${el.dataset.fact}']`))).toBe(`${fact!.value} ${fact!.label}.`);
      if (el.matches(".seat-bar")) expect(text(el.querySelector(".seat-bar__label"))).toBe(fact!.bar ?? fact!.label);
    }
    expect(source).not.toContain("newsletter-reach");
  });

  it("gives facts that share a source one footnote, and numbers the Sources list in order (rule 4)", () => {
    const noteOf = new Map<string, string>();
    for (const el of main.querySelectorAll<HTMLElement>("[data-fact]")) {
      const fact = facts[el.dataset.fact!]!;
      const key = `${fact.source}\n${fact.url}`;
      const n = el.querySelector("a.seat-fn")!.getAttribute("href")!;
      if (noteOf.has(key)) expect(n, el.dataset.fact).toBe(noteOf.get(key));
      else noteOf.set(key, n);
    }
    expect(new Set(noteOf.values()).size).toBe(noteOf.size);
    const entries = [...main.querySelectorAll("[data-sources] li")];
    expect(entries.map((li) => li.id)).toEqual(entries.map((_, i) => `source-${i + 1}`));
    for (const li of entries) expect(text(li)).toMatch(/Read [A-Z][a-z]+ \d{1,2}, \d{4}\.$/);
  });

  it("cites the course lengths and total to Claude Academy, with each course linked", () => {
    const rows = [...main.querySelectorAll<HTMLElement>("[data-course]")];
    expect(rows.length).toBe(3);
    const entry = sourceFor(page, main.querySelector("[data-course-total] a.seat-fn"));
    expect(text(entry)).toContain("Claude Academy");
    for (const row of rows) {
      const course = common.courses[row.dataset.course!]!;
      expect(row.querySelector("a")?.getAttribute("href")).toBe(course.url);
      expect(sourceFor(page, row.querySelector("a.seat-fn"))).toBe(entry);
      expect([...entry!.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toContain(course.url);
    }
  });

  it("puts no numbers on its map, and gives every SVG a title or hides it (rule 5)", () => {
    const map = main.querySelector("[data-map] svg");
    expect(map).not.toBeNull();
    expect(map!.textContent).not.toMatch(/\d/);
    for (const svg of main.querySelectorAll("svg")) {
      if (svg.getAttribute("aria-hidden") === "true") continue;
      expect(svg.getAttribute("role")).toBe("img");
      expect(svg.querySelector("title")?.textContent?.length ?? 0).toBeGreaterThan(5);
    }
  });

  it("shows helpers, never investors, in its diagrams (rule 6)", () => {
    for (const svg of main.querySelectorAll("[data-network] svg, [data-map] svg")) expect(svg.textContent).not.toMatch(/investor/i);
  });

  // Each map and diagram carries a wide drawing and a phone drawing (#329);
  // seats.css shows one. Their ids differ, so aria-labelledby names one figure.
  it("draws each map and diagram twice, wide and for phones, with no repeated id", () => {
    const figures = [...main.querySelectorAll("figure[data-map], figure[data-network]")];
    expect(figures.length).toBeGreaterThan(0);
    for (const fig of figures) {
      expect(fig.querySelectorAll(".seat-figure__wide > svg")).toHaveLength(1);
      expect(fig.querySelectorAll(".seat-figure__narrow > svg.sv--narrow")).toHaveLength(1);
    }
    const ids = [...page.querySelectorAll("[id]")].map((el) => el.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    for (const svg of main.querySelectorAll("figure svg[aria-labelledby]")) {
      for (const ref of svg.getAttribute("aria-labelledby")!.split(" ")) expect(svg.querySelector(`[id='${ref}']`), ref).not.toBeNull();
    }
  });

  // seats.css sizes a .seat-split--figure's first column for a 680-unit
  // drawing, so its labels draw at 15 px or more beside the text (#367). A
  // figure in a plain split, or in the second column, would draw them smaller.
  it("puts each map and diagram in a split in that split's first column, sized for it", () => {
    for (const fig of main.querySelectorAll("figure[data-map], figure[data-network]")) {
      const split = fig.closest(".seat-split");
      if (!split) continue;
      expect(split.classList.contains("seat-split--figure"), fig.outerHTML.slice(0, 60)).toBe(true);
      expect(split.firstElementChild?.contains(fig)).toBe(true);
    }
    for (const split of main.querySelectorAll(".seat-split--figure")) {
      expect(split.firstElementChild?.querySelector("figure[data-map], figure[data-network]")).not.toBeNull();
    }
  });

  it("takes its three steps from roles.json word for word, and step 3 promises an interview only if it fits (rule 7)", () => {
    const steps = [...main.querySelectorAll("[data-steps] li")];
    expect(steps.map((li) => text(li.querySelector("h3")))).toEqual(common.steps.map((s) => s.title));
    expect(steps.map((li) => text(li.querySelector("p")))).toEqual(common.steps.map((s) => s.body));
    expect(text(steps[2])).toContain("If it looks like a fit, Paul sets up an interview");
  });

  it("sends its hero button to #how-to-apply, where the steps come before the apply link (rule 8)", () => {
    const target = page.getElementById("how-to-apply");
    expect(target?.tagName).toBe("SECTION");
    const buttons = [...page.querySelectorAll("[data-seat-hero] a.btn")];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.getAttribute("href")).toBe("#how-to-apply");
    const steps = target!.querySelector("[data-steps]")!;
    const apply = target!.querySelector("a[data-apply]")!;
    expect(steps.compareDocumentPosition(apply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("links its one apply button to the form with this seat chosen (rule 8)", () => {
    const links = [...page.querySelectorAll<HTMLAnchorElement>("a[href*='/get-involved/apply/']")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([`/get-involved/apply/?role=${id}`]);
    expect(links[0]!.hasAttribute("data-apply")).toBe(true);
  });

  it("answers the kit's five questions in order, and ends with its Sources", () => {
    expect([...main.querySelectorAll<HTMLElement>("[data-question]")].map((s) => s.dataset.question)).toEqual([
      "get",
      "network",
      "colorado",
      "who",
      "apply",
    ]);
    expect([...main.querySelectorAll("[data-question] > .wrap > .kicker")].map(text)).toEqual([
      "What you get",
      "How it grows your network",
      "How it helps Colorado",
      "Who we are looking for",
      "How to apply",
    ]);
    expect(main.lastElementChild?.hasAttribute("data-sources")).toBe(true);
  });

  it("links the other three seats", () => {
    const others = SEATS.filter((s) => s !== id);
    const hrefs = [...main.querySelectorAll("[data-other-seats] a")].map((a) => a.getAttribute("href"));
    for (const other of others) expect(hrefs).toContain(`/get-involved/${other}/`);
    expect(hrefs).not.toContain(`/get-involved/${id}/`);
  });

  it("names the seat and says volunteer in its title and description, and carries no JSON-LD", () => {
    expect(text(page.querySelector("title"))).toBe(`${title}, a volunteer seat | Colorado Startups`);
    const description = page.querySelector("meta[name='description']")?.getAttribute("content") ?? "";
    expect(description).toContain(title);
    expect(description).toContain("volunteer");
    expect(page.querySelector("script[type='application/ld+json']")).toBeNull();
    expect(source).not.toMatch(/JobPosting/);
  });

  it("orders headings without skipping a level, keeps ids unique, and is in the sitemap", () => {
    const levels = [...main.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1]));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
    const ids = [...page.querySelectorAll("[id]")].map((e) => e.id);
    expect(ids.filter((x, i) => ids.indexOf(x) !== i)).toEqual([]);
    expect(sitemapPaths()).toContain(`/get-involved/${id}/`);
  });

  it("passes axe (structure and ARIA)", async () => {
    expect(await axeViolations(source)).toEqual([]);
  });
});

describe("/get-involved/fusion-canyon-connector/", () => {
  it("names who the seat works with from roles.json's org.lead", () => {
    const plaque = doc(readDist("get-involved/fusion-canyon-connector/index.html")).querySelector("[data-org-lead]");
    expect(text(plaque)).toBe(`You work with ${common.org.lead}.`);
  });
});

describe("the four pages together", () => {
  const heads = SEATS.map((id) => doc(readDist(`get-involved/${id}/index.html`)));

  it("have unique titles and descriptions", () => {
    const titles = heads.map((p) => text(p.querySelector("title")));
    const descriptions = heads.map((p) => p.querySelector("meta[name='description']")?.getAttribute("content"));
    expect(new Set(titles).size).toBe(4);
    expect(new Set(descriptions).size).toBe(4);
  });
});

describe("/get-involved/ links each seat that takes applications to its page", () => {
  const page = doc(readDist("get-involved/index.html"));

  it("gives exactly the four seat cards one Read about the role link, to a page that exists", () => {
    const links = [...page.querySelectorAll<HTMLAnchorElement>("[data-position] a[data-seat-page]")];
    expect(links.map((a) => a.closest<HTMLElement>("[data-position]")!.dataset.position).sort()).toEqual([...SEATS].sort());
    for (const a of links) {
      const seat = a.closest<HTMLElement>("[data-position]")!.dataset.position!;
      expect(a.getAttribute("href")).toBe(`/get-involved/${seat}/`);
      expect(text(a)).toBe(`Read about the role: ${titleOf(seat)}`);
      expect(() => readDist(`get-involved/${seat}/index.html`)).not.toThrow();
    }
  });
});
