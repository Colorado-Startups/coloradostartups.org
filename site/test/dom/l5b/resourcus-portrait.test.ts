import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { portraitAlt } from "../../../src/components/art/keepers";
import { readDist, SITE_DIR } from "../pages";

// L5b (#209): the Ask Resourcus panel shows Resourcus's small portrait beside
// its heading, on the home page and on Startup Resources. The alt text says
// Resourcus is an AI agent, and the panel keeps its disclosure line. Built
// HTML from dist/ (run `npm run build` first).

const resourcus = (
  parse(readFileSync(path.join(SITE_DIR, "../data/team/dwarves.yaml"), "utf8")) as {
    id: string;
    name: string;
    title: string;
    disclosure: string;
  }[]
).find((d) => d.id === "resourcus")!;
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe.each([
  ["home", "index.html"],
  ["/ecosystem-canvas/", "ecosystem-canvas/index.html"],
])("Ask Resourcus panel on %s", (_name, rel) => {
  const panel = new DOMParser().parseFromString(readDist(rel), "text/html").querySelector("main [data-resourcus]")!;

  it("shows the small Resourcus portrait beside the heading, disclosed as an AI agent", () => {
    const head = panel.querySelector(".resourcus__head")!;
    const fig = head.querySelector('[data-portrait="resourcus"]');
    expect(fig?.classList.contains("portrait--small")).toBe(true);
    const img = fig!.querySelector("img");
    expect(img?.getAttribute("src")).toContain("resourcus-small");
    expect(img?.getAttribute("alt")).toBe(portraitAlt("resourcus", resourcus.name, resourcus.title));
    expect(img?.getAttribute("alt")).toMatch(/an AI agent/);
    expect(head.querySelector("h3")).not.toBeNull();
  });

  it("keeps the disclosure line from dwarves.yaml", () => {
    expect(text(panel.querySelector(".ai-note"))).toBe(resourcus.disclosure);
  });
});
