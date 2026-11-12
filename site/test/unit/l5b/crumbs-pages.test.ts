import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// L5b, the page half of #195 and #259: no page keeps its own copy of the
// breadcrumb style, so every breadcrumb takes global.css's .crumbs, with its
// 44 px phone targets (#682).

const PAGES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../src/pages");
const astroFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? astroFiles(path.join(dir, e.name)) : e.name.endsWith(".astro") ? [path.join(dir, e.name)] : [],
  );

describe("pages and the shared breadcrumb", () => {
  it("keep no copy of the breadcrumb's look", () => {
    const copies = astroFiles(PAGES).filter((f) => /\.crumbs li \+ li::before|\.crumbs ol \{[^}]*list-style/s.test(readFileSync(f, "utf8")));
    expect(copies.map((f) => path.relative(PAGES, f))).toEqual([]);
  });
});
