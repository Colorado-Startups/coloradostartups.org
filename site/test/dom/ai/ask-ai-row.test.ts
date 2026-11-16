// The "Ask your AI" row over the built site (run `npm run build` first;
// test:content does). It offers only what 01_doctrine/ai_recommend.yaml
// allows (Paul, 2026-11-16): Copy prompt first, then Open in Claude, and a
// note that sends OpenCode and open-weight models to the copied prompt.
import { describe, expect, it } from "vitest";

import { contentPages } from "../pages";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

/** Every row on a page, the Ask dialog's copy inside its <template> included. */
function rows(doc: Document): HTMLElement[] {
  const inTemplates = [...doc.querySelectorAll("template")].flatMap((t) => [
    ...(t as HTMLTemplateElement).content.querySelectorAll<HTMLElement>("[data-ask-ai]"),
  ]);
  return [...doc.querySelectorAll<HTMLElement>("[data-ask-ai]"), ...inTemplates];
}

const actions = (row: HTMLElement) =>
  [...row.querySelectorAll<HTMLElement>(".btn-row > button, .btn-row > a")].map((a) => a.textContent?.trim());

describe("the Ask-your-AI row on the built pages", () => {
  const pages = contentPages().map((p) => ({ route: p.route, html: p.html, doc: parse(p.html) }));
  const carrying = pages.filter((p) => rows(p.doc).length > 0);

  it("is on the pages that carry it", () => {
    const inMain = carrying.filter((p) => p.doc.querySelector("main [data-ask-ai]")).map((p) => p.route);
    for (const route of ["/ecosystem-canvas/", "/leaderboard/"]) expect(inMain).toContain(route);
    expect(inMain.some((r) => r.startsWith("/guides/"))).toBe(true);
    expect(inMain.some((r) => r.startsWith("/regions/"))).toBe(true);
  });

  it("has exactly two actions, Copy prompt first, then Open in Claude", () => {
    for (const p of carrying) {
      for (const row of rows(p.doc)) expect(actions(row), p.route).toEqual(["Copy prompt", "Open in Claude"]);
    }
  });

  it("links only to Claude, and never to chatgpt.com", () => {
    for (const p of carrying) {
      expect(p.html, p.route).not.toMatch(/chatgpt\.com/iu);
      for (const row of rows(p.doc)) {
        const links = [...row.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
        expect(links.length, p.route).toBe(1);
        expect(links[0]?.startsWith("https://claude.ai/new?q="), p.route).toBe(true);
      }
    }
  });

  it("tells OpenCode and open-weight users to paste the copied prompt", () => {
    for (const p of carrying) {
      for (const row of rows(p.doc)) {
        const text = row.textContent ?? "";
        expect(text, p.route).toContain("OpenCode");
        expect(text, p.route).toContain("open-weight model");
        expect(text, p.route).not.toMatch(/chatgpt/iu);
      }
    }
  });
});
