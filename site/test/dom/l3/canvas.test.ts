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

  it("ships every row shown, and the Show more row hidden for the island", () => {
    expect(cards.filter((c) => c.hasAttribute("hidden"))).toEqual([]);
    expect(canvas.querySelector("[data-canvas-more-row]")?.hasAttribute("hidden")).toBe(true);
    expect(canvas.querySelector("[data-canvas-count]")?.textContent?.trim()).toBe(`All ${active.length} resources.`);
  });

  // The brief's first screen: the title, the search and the chips, in 40
  // words or fewer (36 on 2026-11-15). Resourcus's panel waits closed in its
  // disclosure, a closed menu shows only its first option, and visually
  // hidden words are for screen readers. Text nodes are joined with spaces,
  // so two chips side by side count as two words.
  it("keeps the first section to 40 words or fewer", () => {
    const top = canvas.querySelector("section[aria-labelledby='canvas-title']")!.cloneNode(true) as Element;
    const unseen = ".visually-hidden, noscript, details > :not(summary), [data-stage-count], select option:not(:first-child)";
    for (const el of top.querySelectorAll(unseen)) el.remove();
    const parts: string[] = [];
    const walk = canvas.createTreeWalker(top, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) parts.push(walk.currentNode.nodeValue ?? "");
    const words = parts.join(" ").split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
    expect(words.length, words.join(" ")).toBeGreaterThan(20);
    expect(words.length, words.join(" ")).toBeLessThanOrEqual(40);
  });

  it("orders headings without skipping a level", () => {
    const levels = [...canvas.querySelectorAll("main h1, main h2, main h3, main h4")].map((h) => Number(h.tagName[1]));
    for (let i = 1; i < levels.length; i += 1) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
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
