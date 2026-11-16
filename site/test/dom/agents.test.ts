// Step A6a over the built site (run `npm run build` first; test:content does):
// /agents/ shows five AI agents in two groups, the three keepers "On this
// site" and the brand's flagged projects "In your own AI tool". Each card
// carries its disclosure exactly as its source writes it (test/agents-source.ts
// reads the sources off disk), every picture's alt says "AI agent", Legallas
// stays off, and every link in a project card goes to its own repo or to
// Claude or OpenCode (01_doctrine/ai_recommend.yaml).
//
// The words lead (Paul, 2026-11-16: "they're supposed to be getting info"):
// each picture is a thumbnail of at most THUMB_MAX px beside the agent's name,
// and the page's first picture sits in the first keeper's card, with that
// keeper's name, job and link.
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { disclosureProblems, SHOWN_CHARACTERS, SOURCE_CHARACTERS, SOURCE_KEEPERS } from "../agents-source";
import { DIST_DIR, readDist, sitemapPaths } from "./pages";

const doc = (rel: string) => new DOMParser().parseFromString(readDist(rel), "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

// Hosts an install link may name besides the project's own repo: Claude's and OpenCode's.
const AI_HOSTS = new Set(["claude.ai", "claude.com", "www.claude.com", "code.claude.com", "opencode.ai"]);
const APPS = new Set(["Claude Code", "Claude Desktop", "claude.ai", "OpenCode"]);
// The widest an agent's thumbnail may be, in CSS px: a small picture that identifies it, never a hero.
const THUMB_MAX = 128;

const page = doc("agents/index.html");
const main = page.querySelector("main")!;
const cards = [...main.querySelectorAll<HTMLElement>("[data-agent]")];
const inGroup = (group: "site" | "project") => [...main.querySelectorAll<HTMLElement>(`[data-group="${group}"] [data-agent]`)];
/** A card's name and its disclosure line as the page renders it, untrimmed. */
const shown = (els: HTMLElement[]) =>
  els.map((c) => ({ name: text(c.querySelector(".hall-card__title")), disclosure: c.querySelector("[data-disclosure]")?.textContent ?? null }));

describe("/agents/", () => {
  it("is titled AI agents, in sentence case", () => {
    expect(text(main.querySelector("h1"))).toBe("AI agents");
  });

  it("shows five AI agents in two groups: On this site, then In your own AI tool", () => {
    const groups = [...main.querySelectorAll("section[id]")].map((s) => [s.id, text(s.querySelector("h2"))]);
    expect(groups).toEqual([
      ["on-this-site", "On this site"],
      ["in-your-ai-tool", "In your own AI tool"],
    ]);
    expect(cards).toHaveLength(5);
    expect(inGroup("site").map((c) => c.dataset.agent)).toEqual(SOURCE_KEEPERS.map((k) => k.id));
    expect(inGroup("project").map((c) => c.dataset.agent)).toEqual(SHOWN_CHARACTERS.map((c) => c.name.toLowerCase()));
    expect(main.querySelector("#on-this-site [data-group='site']")).not.toBeNull();
    expect(main.querySelector("#in-your-ai-tool [data-group='project']")).not.toBeNull();
  });

  it("carries each keeper's disclosure from dwarves.yaml, to the character", () => {
    expect(disclosureProblems(shown(inGroup("site")), SOURCE_KEEPERS)).toEqual([]);
  });

  it("carries each project's disclosure from the brand's characters, to the character", () => {
    expect(disclosureProblems(shown(inGroup("project")), SHOWN_CHARACTERS)).toEqual([]);
  });

  it("keeps every disclosure in sight, inside its own card", () => {
    for (const card of cards) {
      const line = card.querySelector("[data-disclosure]");
      expect(line, card.dataset.agent).not.toBeNull();
      expect(line!.closest("[hidden], [aria-hidden='true'], .visually-hidden, details"), card.dataset.agent).toBeNull();
    }
  });

  it("says AI agent in every picture's alt text, and sizes each picture", () => {
    for (const card of cards) {
      const imgs = [...card.querySelectorAll("img")];
      expect(imgs.length, card.dataset.agent).toBeGreaterThan(0);
      for (const img of imgs) {
        expect(img.getAttribute("alt"), card.dataset.agent).toContain("AI agent");
        for (const attr of ["width", "height", "sizes", "srcset"]) expect(img.getAttribute(attr), `${card.dataset.agent} ${attr}`).toBeTruthy();
      }
    }
    // Every picture but the first waits, and none holds up the page while it decodes.
    const rest = cards.flatMap((c) => [...c.querySelectorAll("img")]).slice(1);
    expect(rest.map((img) => img.getAttribute("loading")).every((l) => l === "lazy")).toBe(true);
    expect(rest.map((img) => img.getAttribute("decoding")).every((d) => d === "async")).toBe(true);
  });

  it("draws each agent's one picture as a thumbnail beside its name, 128 px or less", () => {
    for (const card of cards) {
      const imgs = [...card.querySelectorAll("img")];
      expect(imgs, card.dataset.agent).toHaveLength(1);
      const img = imgs[0]!;
      for (const attr of ["width", "height"]) {
        const px = Number(img.getAttribute(attr));
        expect(px, `${card.dataset.agent} ${attr}`).toBeGreaterThan(0);
        expect(px, `${card.dataset.agent} ${attr}`).toBeLessThanOrEqual(THUMB_MAX);
      }
      // Beside its name: the picture and the name share the card's head.
      const head = img.closest("[data-agent-head]");
      expect(head?.parentElement, card.dataset.agent).toBe(card);
      expect(text(head?.querySelector(".hall-card__title")), card.dataset.agent).toBe(text(card.querySelector(".hall-card__title")));
    }
  });

  it("leads with the first keeper's name, job and link, in the card that holds the page's first picture", () => {
    const first = main.querySelector("img, video, canvas, svg[role='img'], [role='img']");
    const card = first?.closest<HTMLElement>("[data-agent]");
    expect(card).toBe(cards[0]);
    const keeper = SOURCE_KEEPERS[0] as (typeof SOURCE_KEEPERS)[number] & { role: string };
    expect(text(card!.querySelector(".hall-card__title"))).toBe(keeper.name);
    expect(text(card!.querySelector("[data-what]"))).toBe(keeper.role);
    expect(card!.querySelector("a[data-where]")).not.toBeNull();
    // Before that card, main holds only the title, its intro and the group's heading.
    const before = [...main.querySelectorAll("*")].filter((el) => el.compareDocumentPosition(card!) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before.filter((el) => /^H\d$/.test(el.tagName)).map((h) => text(h))).toEqual(["AI agents", "On this site"]);
    expect(before.filter((el) => el.tagName === "P").map((p) => p.classList.contains("lede"))).toEqual([true]);
  });

  it("leaves Legallas off while the brand's agents_page flag is false", () => {
    const legallas = SOURCE_CHARACTERS.find((c) => c.name === "Legallas");
    expect(legallas?.agents_page, "the brand flipped Legallas's flag: add it to the page and this test").toBe(false);
    expect(main.querySelector("[data-agent='legallas']")).toBeNull();
    expect(text(page.body)).not.toMatch(/Legallas/);
    expect(readDist("agents/index.html")).not.toMatch(/legallas/i);
  });

  it("links each keeper to where it works on this site", () => {
    for (const card of inGroup("site")) {
      const href = card.querySelector("a[data-where]")?.getAttribute("href") ?? "";
      expect(href, card.dataset.agent).toMatch(/^\/[a-z-]+\/$/);
      expect(existsSync(path.join(DIST_DIR, href, "index.html")), `${card.dataset.agent}: ${href}`).toBe(true);
    }
  });

  it("gives each project only its repo, Claude or OpenCode links, and names only Claude or OpenCode apps", () => {
    for (const card of inGroup("project")) {
      const character = SHOWN_CHARACTERS.find((c) => c.name.toLowerCase() === card.dataset.agent)!;
      const repo = `https://github.com/${character.repo}`;
      expect(card.querySelector("a[data-repo]")?.getAttribute("href"), card.dataset.agent).toBe(repo);
      for (const a of card.querySelectorAll("a[href]")) {
        const href = a.getAttribute("href")!;
        const ok = href === repo || href.startsWith(`${repo}#`) || href.startsWith(`${repo}/`) || AI_HOSTS.has(new URL(href).hostname);
        expect(ok, `${card.dataset.agent}: ${href}`).toBe(true);
      }
      const installs = [...card.querySelectorAll<HTMLElement>("[data-install]")];
      expect(installs.length, card.dataset.agent).toBeGreaterThan(0);
      for (const i of installs) expect(APPS.has(i.dataset.install!), `${card.dataset.agent}: ${i.dataset.install}`).toBe(true);
    }
  });

  it("is in the sitemap", () => {
    expect(sitemapPaths()).toContain("/agents/");
  });

  it("has its own Open Graph card, built", () => {
    const og = page.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? "";
    expect(new URL(og).pathname).toBe("/og/agents.jpg");
    expect(existsSync(path.join(DIST_DIR, "og/agents.jpg"))).toBe(true);
  });

  it("orders its headings without skipping a level", () => {
    const levels = [...main.querySelectorAll("h1, h2, h3, h4")].map((h) => Number(h.tagName[1]));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
  });

  it("uses the brand's words: AI agents, never the Guild, quests or badges", () => {
    expect(text(main)).not.toMatch(/\b(?:guild|quests?|badges?)\b/i);
    expect(text(main)).not.toMatch(/—|\s–\s/);
  });
});

describe("links to /agents/", () => {
  it("from the footer's About group, on this page and the home page", () => {
    for (const rel of ["agents/index.html", "index.html"]) {
      const about = doc(rel).querySelector('.site-footer nav[aria-label="About"]');
      expect(about?.querySelector("a[href='/agents/']"), rel).not.toBeNull();
    }
  });

  it("from the home page's keeper strip, beside Meet the team", () => {
    const strip = doc("index.html").querySelector("main [data-keeper-strip]")!;
    expect([...strip.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["/team/", "/agents/"]);
  });

  it("from llms.txt", () => {
    expect(readDist("llms.txt")).toMatch(/^- \[AI agents\]\(https:\/\/coloradostartups\.org\/agents\/\): /m);
  });
});
