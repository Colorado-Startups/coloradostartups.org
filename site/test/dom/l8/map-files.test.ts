import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { REGION_IDS } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { DIST_DIR } from "../pages";

// /maps/colorado.svg and /maps/<region>.svg (pages/maps/[view].svg.ts): each
// map as one standalone SVG file, for a README or any page that shows it with
// an image tag. Built HTML from dist/ (run `npm run build` first).
describe.each(["colorado", ...REGION_IDS])("/maps/%s.svg", (view) => {
  const file = path.join(DIST_DIR, "maps", `${view}.svg`);

  it("is built as one well-formed SVG that needs nothing from the site", () => {
    expect(existsSync(file)).toBe(true);
    const svg = readFileSync(file, "utf8");
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.documentElement.nodeName).toBe("svg");
    // No token is left for a stylesheet to resolve, and the relief travels inside the file.
    expect(svg).not.toContain("var(--");
    expect(doc.querySelector("image")?.getAttribute("href")).toMatch(/^data:image\/jpeg;base64,/);
    expect(doc.documentElement.getAttribute("aria-label")).toMatch(/^Map of /);
  });
});
