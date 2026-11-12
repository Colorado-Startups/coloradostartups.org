// The header's nav items and its current-page test (cards #140, #141 and #150).
// The first block runs on nav.ts alone; the second reads the built site, so run
// `npm run build` first (test:content does).
import { describe, expect, it } from "vitest";

import { isCurrent, NAV, type NavItem } from "../../../src/components/ui/nav";
import { GUIDE_SLUGS } from "../../../src/lib/guides/guides";
import { contentPages, readDist } from "../pages";

const LABELS = ["Community", "Startup Resources", "Leaderboard", "Regions", "Team", "Get involved"];
const RESOURCES = NAV.find((item) => item.label === "Startup Resources")!;

describe("NAV", () => {
  it("lists six items, Get involved last", () => {
    expect(NAV.map((item) => item.label)).toEqual(LABELS);
    expect(NAV.at(-1)?.href).toBe("/get-involved/");
  });

  it('calls the directory "Startup Resources" and keeps its URL', () => {
    expect(RESOURCES.href).toBe("/ecosystem-canvas/");
  });
});

describe("isCurrent", () => {
  const team: NavItem = { href: "/team/", label: "Team" };

  it("marks an item current on its own pages (known clean)", () => {
    expect(isCurrent(team, "/team/")).toBe(true);
    expect(isCurrent(RESOURCES, "/ecosystem-canvas/")).toBe(true);
  });

  it("marks Startup Resources current under /guides/", () => {
    expect(isCurrent(RESOURCES, "/guides/")).toBe(true);
    expect(isCurrent(RESOURCES, "/guides/funding-programs/")).toBe(true);
  });

  it("leaves an item alone on other pages (known bad)", () => {
    expect(isCurrent(team, "/")).toBe(false);
    expect(isCurrent(team, "/teams/")).toBe(false);
    expect(isCurrent(RESOURCES, "/guidesx/")).toBe(false);
    expect(isCurrent(RESOURCES, "/leaderboard/")).toBe(false);
  });
});

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const navLinks = (doc: Document) => [...doc.querySelectorAll<HTMLAnchorElement>("header #site-nav ul a")];
const current = (doc: Document) =>
  navLinks(doc)
    .filter((a) => a.getAttribute("aria-current") === "page")
    .map((a) => (a.textContent ?? "").trim());

describe("the built header", () => {
  it.each(contentPages().map((p) => [p.route, p] as const))("%s lists the six items in order", (_route, page) => {
    const links = navLinks(parse(page.html));
    expect(links.map((a) => (a.textContent ?? "").trim())).toEqual(LABELS);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(NAV.map((item) => item.href));
  });

  const cases: [string, string[]][] = [
    ["index.html", []],
    ["ecosystem-canvas/index.html", ["Startup Resources"]],
    ["guides/index.html", ["Startup Resources"]],
    ...GUIDE_SLUGS.map((slug): [string, string[]] => [`guides/${slug}/index.html`, ["Startup Resources"]]),
    ["guides/startup-credits/index.html", ["Startup Resources"]],
    ["get-involved/index.html", ["Get involved"]],
    ["team/index.html", ["Team"]],
  ];
  it.each(cases)("%s marks %j as the current page", (file, expected) => {
    expect(current(parse(readDist(file)))).toEqual(expected);
  });
});
