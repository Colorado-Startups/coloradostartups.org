// L3 over the built site (run `npm run build` first; test:content does):
// the directory renders exactly the active records, with the anchors other
// lanes rely on, and /data/resources.json matches it.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { ResourceCardSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { readDist, SITE_DIR } from "../pages";

const DATA = path.resolve(SITE_DIR, "..", "data", "resources");
const records = readdirSync(DATA, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => readdirSync(path.join(DATA, d.name)).map((f) => parse(readFileSync(path.join(DATA, d.name, f), "utf8"))));
const active = records.filter((r) => r.status === "active");
const notActive = records.filter((r) => r.status !== "active");

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const canvas = doc(readDist("ecosystem-canvas/index.html"));

describe("/ecosystem-canvas/", () => {
  const cards = [...canvas.querySelectorAll<HTMLElement>("[data-resource]")];

  it("renders one card per active record and none for review or dead records", () => {
    expect(cards.map((c) => c.dataset.id).sort()).toEqual(active.map((r) => r.id).sort());
    const shown = new Set(cards.map((c) => c.dataset.id));
    expect(notActive.filter((r) => shown.has(r.id)).map((r) => r.id)).toEqual([]);
  });

  it("gives each row a heading anchor r-<id> that links to the resource", () => {
    const byId = new Map(active.map((r) => [r.id, r]));
    for (const card of cards) {
      const h = card.querySelector("h3");
      expect(h?.id).toBe(`r-${card.dataset.id}`);
      expect(h?.querySelector("a")?.getAttribute("href")).toBe(byId.get(card.dataset.id ?? "")?.url);
    }
  });

  it("exposes the stage anchors idea, launch, growth and support (decision 33)", () => {
    for (const stage of ["idea", "launch", "growth", "support"]) {
      expect(canvas.querySelector(`section#${stage}`), stage).not.toBeNull();
    }
    const ids = [...canvas.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps Founder Institute's credit", () => {
    const closing = canvas.querySelector("section[aria-labelledby='missing-title']");
    expect(closing?.textContent).toMatch(/created by\s+Founder Institute and Colorado Startups/);
  });

  // Step F (2026-11-15): the form is in the first paint, so the island moves
  // nothing in the first screen (CLS); a noscript style hides it without
  // JavaScript, when it could not filter.
  it("ships the filter form shown, hidden only without JavaScript, and keeps it out of the search index", () => {
    const form = canvas.querySelector("form[data-canvas-filters]");
    expect(form?.hasAttribute("hidden")).toBe(false);
    expect(form?.getAttribute("role")).toBe("search");
    expect(form?.closest("[data-pagefind-ignore]")).not.toBeNull();
    const noscript = [...canvas.querySelectorAll("noscript")].map((n) => n.textContent ?? "").join(" ");
    expect(noscript).toMatch(/\.canvas-filters\s*\{\s*display:\s*none/);
  });

  it("offers stage and type as radio chips, with the journey's stage counts, and the city as a menu", () => {
    const form = canvas.querySelector("form[data-canvas-filters]")!;
    const values = (name: string) => [...form.querySelectorAll<HTMLInputElement>(`input[type=radio][name=${name}]`)].map((i) => i.value);
    expect(values("stage")).toEqual(["idea", "launch", "growth", "support", ""]);
    expect(values("type")[0]).toBe("");
    expect(new Set(values("type").slice(1))).toEqual(new Set(active.map((r) => r.type)));
    for (const name of ["stage", "type"]) {
      expect(form.querySelector<HTMLInputElement>(`input[name=${name}][value=""]`)?.hasAttribute("checked"), name).toBe(true);
    }
    const count = (stage: string) => Number(form.querySelector(`[data-stage-count="${stage}"]`)?.textContent);
    for (const stage of ["idea", "launch", "growth", "support"]) {
      expect(count(stage), stage).toBe(active.filter((r) => r.stage === stage).length);
    }
    expect(count("")).toBe(active.length);
    expect(form.querySelector("select[name=city]")).not.toBeNull();
  });

  // Step L1b: the full list waits behind "Show all N resources". It ships
  // hidden for the island, and a noscript style shows it (and drops the
  // button, which could do nothing) when JavaScript is off.
  it("ships the full list behind its control, shown without JavaScript", () => {
    const full = canvas.querySelector<HTMLElement>("[data-canvas-full]");
    expect(full?.hasAttribute("hidden")).toBe(true);
    expect(full?.id).toBe("all-resources");
    for (const card of cards) expect(full?.contains(card)).toBe(true);
    const button = canvas.querySelector<HTMLButtonElement>("button[data-canvas-show-all]");
    expect(button?.getAttribute("aria-controls")).toBe("all-resources");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    const noscript = [...canvas.querySelectorAll("noscript")].map((n) => n.textContent ?? "").join(" ");
    expect(noscript).toMatch(/\.canvas-full\[hidden\]\s*\{\s*display:\s*block/);
    expect(noscript).toMatch(/\.canvas-show\s*\{\s*display:\s*none/);
  });

  // PR #89 review: the search box stays above the picks, so a visitor who
  // came to search needs no extra click. It joins the filter form by its form
  // attribute, and hides without JavaScript like the form.
  it("keeps the search box in the first section, joined to the filter form", () => {
    const top = canvas.querySelector("section[aria-labelledby='canvas-title']")!;
    const q = top.querySelector<HTMLInputElement>("input[name=q][type=search]");
    expect(q?.getAttribute("form")).toBe("canvas-filters");
    expect(canvas.querySelector("form#canvas-filters[data-canvas-filters]")).not.toBeNull();
    expect(canvas.querySelector(`label[for='${q?.id}']`)?.textContent?.trim()).toBe("Search");
    expect(q?.closest("[data-pagefind-ignore]")).not.toBeNull();
    const noscript = [...canvas.querySelectorAll("noscript")].map((n) => n.textContent ?? "").join(" ");
    expect(noscript).toMatch(/\.canvas-search\s*\{\s*display:\s*none/);
  });

  // The list ships hidden for the island; Pagefind reads the built HTML, and
  // only data-pagefind-ignore keeps text out, so every row stays indexable.
  it("leaves the hidden list and its rows open to the search index", () => {
    const full = canvas.querySelector("[data-canvas-full]")!;
    expect(full.closest("[data-pagefind-ignore]")).toBeNull();
    for (const card of cards) expect(card.closest("[data-pagefind-ignore]"), card.dataset.id).toBeNull();
  });

  it("counts the real list in the control", () => {
    const text = canvas.querySelector("button[data-canvas-show-all]")?.textContent?.trim();
    expect(text).toBe(`Show all ${cards.length} resources`);
    expect(cards.length).toBe(active.length);
  });

  it("ships every row shown, and the Show more row hidden for the island", () => {
    expect(cards.filter((c) => c.hasAttribute("hidden"))).toEqual([]);
    expect(canvas.querySelector("[data-canvas-more-row]")?.hasAttribute("hidden")).toBe(true);
    expect(canvas.querySelector("[data-canvas-count]")?.textContent?.trim()).toBe(`All ${active.length} resources.`);
  });

  // PR #89 review: a browse row's ?substage= had no visible label. The chip
  // ships hidden beside the count line; the island names it and shows it.
  it("ships the kind chip hidden beside the count line, with a named remove button", () => {
    const row = canvas.querySelector<HTMLElement>(".canvas-count-row")!;
    expect(row.querySelector("[data-canvas-count]")).not.toBeNull();
    expect(row.querySelector("[data-canvas-count]")?.getAttribute("tabindex")).toBe("-1");
    const kind = row.querySelector<HTMLElement>("[data-canvas-kind]");
    expect(kind?.hasAttribute("hidden")).toBe(true);
    expect(kind?.textContent).toMatch(/^\s*Kind:/);
    expect(kind?.querySelector("[data-canvas-kind-name]")).not.toBeNull();
    const remove = kind?.querySelector<HTMLButtonElement>("button[data-canvas-kind-remove]");
    expect(remove?.getAttribute("type")).toBe("button");
    expect(remove?.getAttribute("aria-label")).toBe("Remove the kind filter");
  });

  // The brief's first section: the title, one line and Resourcus's
  // disclosure, in 40 words or fewer (step F; since step L1b the picks
  // follow it and the search moved under "Show all"). Resourcus's panel waits
  // closed in its disclosure, a closed menu shows only its first option, and
  // visually hidden words are for screen readers. Text nodes are joined with
  // spaces, so two chips side by side count as two words.
  it("keeps the first section to 40 words or fewer", () => {
    const top = canvas.querySelector("section[aria-labelledby='canvas-title']")!.cloneNode(true) as Element;
    const unseen = ".visually-hidden, noscript, details > :not(summary), [data-stage-count], select option:not(:first-child)";
    for (const el of top.querySelectorAll(unseen)) el.remove();
    const parts: string[] = [];
    const walk = canvas.createTreeWalker(top, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) parts.push(walk.currentNode.nodeValue ?? "");
    const words = parts.join(" ").split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
    expect(words.length, words.join(" ")).toBeGreaterThan(10);
    expect(words.length, words.join(" ")).toBeLessThanOrEqual(40);
  });

  it("orders headings without skipping a level", () => {
    const levels = [...canvas.querySelectorAll("main h1, main h2, main h3, main h4")].map((h) => Number(h.tagName[1]));
    for (let i = 1; i < levels.length; i += 1) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  });
});

// Step L1b: the page opens on "Start here", up to 3 picks a stage from
// topPicks(), each one a resource in the full list, and never reads as a
// vendor directory.
describe("/ecosystem-canvas/ Start here", () => {
  const band = canvas.querySelector<HTMLElement>("[data-canvas-picks]")!;
  const picks = [...band.querySelectorAll<HTMLElement>("[data-pick]")];
  const listed = new Map([...canvas.querySelectorAll<HTMLElement>("[data-resource]")].map((c) => [c.dataset.id, c]));

  it("comes before the full list and its control", () => {
    const show = canvas.querySelector("[data-canvas-show-all]")!;
    expect(band.compareDocumentPosition(show) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(band.querySelector("#start-title")?.textContent?.trim()).toBe("Start here");
  });

  it("shows at most 3 picks a stage, each a resource in the full list", () => {
    expect(picks.length).toBeGreaterThan(0);
    for (const stage of band.querySelectorAll(".start-here__stage")) {
      expect(stage.querySelectorAll("[data-pick]").length).toBeLessThanOrEqual(3);
    }
    for (const pick of picks) {
      const row = listed.get(pick.dataset.id);
      expect(row, pick.dataset.id).toBeDefined();
      expect(pick.querySelector("a")?.getAttribute("href")).toBe(row?.querySelector("h3 a")?.getAttribute("href"));
    }
    expect(new Set(picks.map((p) => p.dataset.id)).size).toBe(picks.length);
  });

  it("gives each pick its type, city and reason, and says how picks are chosen", () => {
    for (const pick of picks) {
      expect(pick.querySelectorAll(".hall-badge").length, pick.dataset.id).toBe(2);
      expect(pick.querySelector(".hall-card__meta")?.textContent?.trim(), pick.dataset.id).not.toBe("");
    }
    const how = band.querySelector("[data-picks-how]")?.textContent ?? "";
    expect(how).toMatch(/simple rules/);
    expect(how).toMatch(/No one pays/);
    expect(how).toMatch(/full list below/);
  });

  // PR #89 review: a stage with no picks shows one link per substage, its
  // count from the data, each opening the list filtered to that substage.
  it("shows a browse row with the data's counts for a stage with no picks", () => {
    const rows = [...band.querySelectorAll<HTMLElement>("[data-browse-row]")];
    expect(rows.map((r) => r.dataset.stage)).toContain("growth");
    const all = [...listed.values()];
    for (const row of rows) {
      const stage = row.dataset.stage!;
      expect(row.closest(".start-here__stage")?.querySelectorAll("[data-pick]").length, stage).toBe(0);
      expect(row.textContent, stage).not.toMatch(/first need/i);
      const links = [...row.querySelectorAll<HTMLAnchorElement>("a[data-substage]")];
      expect(links.length, stage).toBeGreaterThan(0);
      for (const a of links) {
        const substage = a.dataset.substage!;
        const n = all.filter((c) => c.dataset.stage === stage && c.dataset.substage === substage).length;
        expect(Number(a.dataset.count), substage).toBe(n);
        expect(a.textContent?.trim(), substage).toMatch(new RegExp(`^${n} `));
        expect(a.getAttribute("href"), substage).toBe(`/ecosystem-canvas/?stage=${stage}&substage=${substage}`);
      }
    }
  });

  it("uses no ranking words in the band or the control", () => {
    const words = `${band.textContent} ${canvas.querySelector("[data-canvas-show-all]")?.textContent}`;
    expect(words).not.toMatch(/\b(best|top|recommended)\b/i);
  });

  it("keeps the band out of the search index and has one Ask your AI row", () => {
    expect(band.hasAttribute("data-pagefind-ignore")).toBe(true);
    expect(canvas.querySelectorAll("[data-ask-ai]").length).toBe(1);
  });
});

describe("/data/resources.json", () => {
  const cards = JSON.parse(readDist("data/resources.json"));

  it("lists the active records as ResourceCards, sorted by id", () => {
    expect(cards.map((c: { id: string }) => c.id)).toEqual(active.map((r) => r.id).sort((a, b) => a.localeCompare(b)));
    for (const c of cards) expect(ResourceCardSchema.strict().safeParse(c).success).toBe(true);
  });
});

describe("/ecosystem-canvas/suggest/", () => {
  const page = doc(readDist("ecosystem-canvas/suggest/index.html"));
  const form = page.querySelector<HTMLFormElement>("form[data-suggest-form]");

  it("posts to the route with the pipeline's hidden fields", () => {
    expect(form?.getAttribute("action")).toBe("/api/suggest-resource");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.querySelector("input[name='website']")?.closest(".hp")?.getAttribute("aria-hidden")).toBe("true");
    expect(form?.querySelector("input[name='ts']")).not.toBeNull();
    expect(form?.querySelector<HTMLInputElement>("input[name='return_to']")?.value).toBe("/ecosystem-canvas/suggest/");
  });

  it("labels every visible field", () => {
    const fields = [...(form?.querySelectorAll("input:not([type='hidden']), select, textarea") ?? [])];
    for (const f of fields) expect(page.querySelector(`label[for='${f.id}']`), f.getAttribute("name") ?? "").not.toBeNull();
  });
});

describe("/ecosystem-canvas/suggest/thanks/", () => {
  it("is kept out of search engines", () => {
    const page = doc(readDist("ecosystem-canvas/suggest/thanks/index.html"));
    expect(page.querySelector("meta[name='robots']")?.getAttribute("content")).toBe("noindex");
  });
});
