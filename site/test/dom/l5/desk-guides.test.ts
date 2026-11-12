import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { WAYS_IN } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { DIST_DIR, readDist, SITE_DIR } from "../pages";

// Card #150: the built welcome desk opens the founder guides from the idea and
// building doors, on the home page and on /community/. Run `npm run build`
// first (test:content does).

const routes = parse(readFileSync(path.join(SITE_DIR, "../data/communitas/routes.yaml"), "utf8")) as {
  id: string;
  label: string;
}[];
const label = (id: string) => routes.find((r) => r.id === id)!.label;

const DOORS = [
  ["idea", WAYS_IN["guide-start"]],
  ["building", WAYS_IN["guide-accelerators"]],
] as const;

describe.each(["index.html", "community/index.html"])("the welcome desk on %s", (file) => {
  const desk = new DOMParser().parseFromString(readDist(file), "text/html").querySelector(".welcome-desk")!;
  const door = (id: string) =>
    [...desk.querySelectorAll("details")].find((d) => d.querySelector("summary")?.textContent?.trim() === label(id));

  it.each(DOORS)("links the %s door to %s, a page in the build", (id, href) => {
    const hrefs = [...(door(id)?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(href);
    expect(existsSync(path.join(DIST_DIR, href, "index.html")), href).toBe(true);
  });
});
