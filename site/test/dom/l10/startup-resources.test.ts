// The "Startup Resources" retitle over the built site (decision 46, as the
// orchestrator ruled on 2026-10-18). The page and the nav use "Startup
// Resources". "Ecosystem Canvas" stays as the name of the dataset, credited
// with Founder Institute, and "Map Room" stays in lore (#141). Run
// `npm run build` first; test:content does.
import { readFileSync } from "node:fs";
import path from "node:path";

import { WAYS_IN } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { readDist, SITE_DIR } from "../pages";

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const canvas = doc(readDist("ecosystem-canvas/index.html"));
const home = doc(readDist("index.html"));
const team = doc(readDist("team/index.html"));
const STAGE_IDS = ["idea", "launch", "growth", "support"];
const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("/ecosystem-canvas/ is titled Startup Resources", () => {
  it("in its title, h1 and meta description", () => {
    expect(canvas.title).toBe("Startup Resources | Colorado Startups");
    expect(canvas.querySelector("h1")?.textContent?.trim()).toBe("Startup Resources");
    expect(canvas.querySelector('meta[name="description"]')?.getAttribute("content")).toMatch(/^Startup Resources/);
  });

  it("credits the Ecosystem Canvas and Founder Institute in its intro", () => {
    const intro = canvas.querySelector("section[aria-labelledby='canvas-title']")?.textContent ?? "";
    expect(intro).toMatch(/built on the Ecosystem Canvas/);
    expect(intro).toMatch(/created by\s+Founder Institute and Colorado Startups/);
  });

  it("keeps the stage anchors the welcome desk links to (decision 33c)", () => {
    for (const stage of ["idea", "launch", "growth", "support"]) {
      expect(canvas.querySelector(`section#${stage}`), stage).not.toBeNull();
    }
  });
});

describe("the first result follows the filters (#143)", () => {
  const find = canvas.querySelector<HTMLElement>("section[aria-labelledby='find-title']")!;
  const form = find.querySelector("form[data-canvas-filters]")!;
  const status = find.querySelector("[data-canvas-count]")!;
  const ask = find.querySelector<HTMLDetailsElement>("details[data-canvas-ask]");

  it("keeps the count right under the filters, as a polite live region", () => {
    expect(follows(form, status)).toBe(true);
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
  });

  it("puts Resourcus behind a closed Ask a question instead disclosure, after the count", () => {
    expect(ask?.querySelector(":scope > summary")?.textContent?.trim()).toBe("Ask a question instead");
    expect(ask?.hasAttribute("open")).toBe(false);
    expect(follows(status, ask!)).toBe(true);
    const panels = [...canvas.querySelectorAll("main [data-resourcus]")];
    expect(panels).toHaveLength(1);
    expect(panels[0].closest("details[data-canvas-ask]")).toBe(ask);
    // The panel keeps its AI-agent disclosure inside the disclosure widget.
    expect(panels[0].querySelector(".ai-note")?.textContent).toMatch(/Resourcus is an AI agent/);
  });

  it("goes straight from the filters to the first stage", () => {
    expect(find.nextElementSibling?.id).toBe("idea");
    const first = canvas.querySelector("main [data-resource]")!;
    expect(first.closest("section")?.id).toBe("idea");
  });

  it("ends each stage with a Back to filters link that the island reveals", () => {
    for (const stage of STAGE_IDS) {
      const section = canvas.querySelector(`section#${stage}`)!;
      const back = section.querySelector<HTMLElement>("[data-canvas-back]");
      expect(back, stage).not.toBeNull();
      expect(back?.parentElement?.lastElementChild, stage).toBe(back);
      expect(back?.hasAttribute("hidden"), stage).toBe(true);
      expect(back?.hasAttribute("data-pagefind-ignore"), stage).toBe(true);
      const link = back?.querySelector("a");
      expect(link?.textContent?.trim(), stage).toBe("Back to filters");
      expect(link?.getAttribute("href"), stage).toBe("#find-title");
      expect(link?.classList.contains("btn--quiet"), stage).toBe(true);
    }
    expect(canvas.getElementById("find-title")?.closest("section")).toBe(find);
  });

  it("gives the back link a 44 px tap target through .btn--quiet", () => {
    const styles = (file: string) => readFileSync(path.join(SITE_DIR, "src", "styles", file), "utf8");
    expect(styles("hall.css")).toMatch(/\.btn--quiet\s*\{[^}]*min-height:\s*var\(--size-tap\)/);
    expect(styles("tokens.css")).toMatch(/--size-tap:\s*44px;/);
  });
});

describe("one name, Startup Resources, for the directory (#141)", () => {
  // Resource descriptions say "Listed in the Ecosystem Canvas", crediting the
  // source list each record came from; they are data, not page copy.
  const copy = (root: Element) => {
    const clone = root.cloneNode(true) as Element;
    for (const el of clone.querySelectorAll("[data-resource]")) el.remove();
    return clone.textContent ?? "";
  };

  it("names the Ecosystem Canvas on the directory page only to credit Founder Institute", () => {
    const text = copy(canvas.querySelector("main")!);
    expect(text.match(/Canvas/g)).toHaveLength(1);
    expect(text).toMatch(/built on the Ecosystem Canvas, created by\s+Founder Institute/);
    expect(text).not.toMatch(/Map Room/);
  });

  it("badges the home page's directory card without a second name", () => {
    const teaser = home.querySelector('[data-teaser="resources"]');
    expect(teaser?.textContent).not.toMatch(/Map Room|Canvas/);
    expect(teaser?.querySelector(".hall-badge")?.textContent?.trim()).toBe("Directory");
  });

  it("says Startup Resources in the Resourcus panel on both pages that place it", () => {
    for (const page of [home, canvas]) {
      const panel = page.querySelector("main [data-resourcus]");
      expect(panel?.textContent).toMatch(/Resourcus searches Startup Resources/);
      expect(panel?.textContent).not.toMatch(/Canvas/);
    }
  });

  it("calls Resourcus the Keeper of Startup Resources, with its AI-agent disclosure intact", () => {
    const card = team.querySelector("[data-keeper='resourcus']");
    expect(card?.querySelector(".keeper__title")?.textContent?.trim()).toBe("Keeper of Startup Resources");
    expect(card?.textContent).not.toMatch(/Canvas/);
    expect(card?.querySelector("[data-disclosure]")?.textContent).toMatch(/^Resourcus is an AI agent run by Colorado Startups/);
    expect(card?.querySelector("img")?.getAttribute("alt")).toMatch(/Keeper of Startup Resources: an AI agent/);
    const teaser = home.querySelector("[data-keeper='resourcus']");
    expect(teaser?.textContent).toMatch(/Keeper of Startup Resources\./);
    expect(teaser?.textContent).not.toMatch(/Canvas/);
  });
});

describe("the welcome desk hands questions to Resourcus in Startup Resources", () => {
  it("names the page by its new title", () => {
    const desk = home.querySelector(".welcome-desk");
    const handoff = [...(desk?.querySelectorAll("a") ?? [])].find((a) => /Ask Resourcus/.test(a.textContent ?? ""));
    expect(handoff?.textContent?.trim()).toBe("Ask Resourcus in Startup Resources");
    expect(handoff?.getAttribute("href")).toBe(WAYS_IN.canvas);
  });
});
