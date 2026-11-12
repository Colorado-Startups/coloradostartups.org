// L34 over the built site (run `npm run build` first; test:content does):
// /data/ answers first with the license, offers the file as one gold button
// under the lede (#214), states a sourced count, offers the credit line from
// lib/data/license.ts and carries one Dataset JSON-LD block.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { RESOURCES_JSON_PATH } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { attributionHtml, attributionText, LICENSE } from "../../../src/lib/data/license";
import { readDist, SITE_DIR, sitemapPaths } from "../pages";

const SITE = new URL("https://coloradostartups.org");
const DATA = path.resolve(SITE_DIR, "..", "data", "resources");
const activeCount = readdirSync(DATA, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => readdirSync(path.join(DATA, d.name)).map((f) => parse(readFileSync(path.join(DATA, d.name, f), "utf8"))))
  .filter((r) => r.status === "active").length;

const page = new DOMParser().parseFromString(readDist("data/index.html"), "text/html");
const main = page.querySelector("main")!;
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("/data/", () => {
  it("answers first: the h1's section says the data is free to reuse under CC BY 4.0", () => {
    const answer = main.querySelector("[data-data-answer]");
    expect(answer?.closest("section")?.querySelector("h1")).not.toBeNull();
    expect(text(answer)).toMatch(/^Startup Resources is free to reuse\./);
    const license = answer?.querySelector("a[rel~='license']");
    expect(license?.getAttribute("href")).toBe(LICENSE.url);
    expect(text(license)).toBe(LICENSE.name);
  });

  it("offers the file once, as a gold button right under the lede (#214)", () => {
    const answer = main.querySelector("[data-data-answer]")!;
    const get = main.querySelector("[data-data-get]");
    expect(get?.tagName).toBe("A");
    expect(get?.getAttribute("href")).toBe(RESOURCES_JSON_PATH);
    expect(text(get)).toBe("Get resources.json");
    // .btn is 48 px tall at every width (hall.css); .btn--gold is the main action.
    expect(get?.classList.contains("btn")).toBe(true);
    expect(get?.classList.contains("btn--gold")).toBe(true);
    // The button's row is the lede's next sibling, in the h1's section.
    expect(answer.nextElementSibling).toBe(get?.parentElement);
    // The lede names the file but no longer links it, so the hero offers it once.
    expect(text(answer.querySelector("code"))).toBe(RESOURCES_JSON_PATH);
    const hero = answer.closest("section")!;
    expect(hero.querySelectorAll(`a[href='${RESOURCES_JSON_PATH}']`)).toHaveLength(1);
  });

  it("states the count of active records, with its source and date in the same sentence", () => {
    const line = main.querySelector("[data-data-count]");
    const time = line?.querySelector("time");
    expect(time?.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(text(line)).toBe(`Startup Resources lists ${activeCount} active resources as of ${text(time)}.`);
  });

  it("offers the credit lines exactly as lib/data/license.ts writes them", () => {
    expect(text(main.querySelector("[data-credit='text']"))).toBe(attributionText(SITE));
    // The HTML line renders as text, so a reader copies the markup itself.
    expect(main.querySelector("[data-credit='html']")?.textContent).toBe(attributionHtml(SITE));
    expect(main.querySelector("[data-credit='html'] a")).toBeNull();
  });

  it("carries exactly one JSON-LD block, a Dataset with the license and the download", () => {
    const blocks = [...page.querySelectorAll("script[type='application/ld+json']")];
    expect(blocks).toHaveLength(1);
    const ld = JSON.parse(blocks[0]!.textContent ?? "");
    expect(ld["@type"]).toBe("Dataset");
    expect(ld.license).toBe(LICENSE.url);
    expect(ld.distribution[0].contentUrl).toBe("https://coloradostartups.org/data/resources.json");
  });

  it("is in the sitemap", () => {
    expect(sitemapPaths()).toContain("/data/");
  });
});
