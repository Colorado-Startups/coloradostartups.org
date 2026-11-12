// L16: the review-Artifact inliner (scripts/artifacts/inline-page.mjs) and its
// manifest (ops/artifacts/artifacts.json). The script itself needs a build, so
// this covers its pure helpers and the manifest contract.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";
import { afterAll, describe, expect, it } from "vitest";

import {
  bundle,
  contrastHtml,
  docImageFile,
  dropReason,
  MANIFEST,
  mdSection,
  mdTableHtml,
  nearMinimum,
  normalizeRoute,
  paletteHtml,
  pickCandidate,
  routeOf,
  safeInline,
  scriptKind,
  unlistedPages,
  writtenCommit,
} from "../../../../scripts/artifacts/inline-page.mjs";

// Scratch folders for the fixture builds, removed after the run.
const scratch = mkdtempSync(path.join(tmpdir(), "l16-inline-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
function put(rel: string, text = "x"): string {
  const file = path.join(scratch, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

interface Entry {
  file: string;
  title: string;
  slug: string;
  url: string | null;
}
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { pages: Entry[]; docs: Entry[] };

describe("routes", () => {
  it("maps built files to the paths visitors use", () => {
    expect(routeOf("index.html")).toBe("/");
    expect(routeOf("community/index.html")).toBe("/community/");
    expect(routeOf("leaderboard/nominate/thanks/index.html")).toBe("/leaderboard/nominate/thanks/");
    expect(routeOf("404.html")).toBe("/404.html");
  });

  it("normalizes a link's path the way the site's trailing-slash rule does", () => {
    expect(normalizeRoute("/community")).toBe("/community/");
    expect(normalizeRoute("/ecosystem-canvas/?stage=idea#launch")).toBe("/ecosystem-canvas/");
    expect(normalizeRoute("/brand/cs-logo-240.png")).toBe("/brand/cs-logo-240.png");
    expect(normalizeRoute("#main")).toBe("/");
  });
});

describe("images", () => {
  it("keeps the widest srcset candidate up to 2000px", () => {
    expect(pickCandidate("/a-176.webp 176w, /a-352.webp 352w")).toBe("/a-352.webp");
    expect(pickCandidate("/h-1200.webp 1200w, /h-2400.webp 2400w, /h-1920.webp 1920w")).toBe("/h-1920.webp");
  });

  it("falls back to the narrowest candidate when every one is wider", () => {
    expect(pickCandidate("/h-3000.webp 3000w, /h-2400.webp 2400w")).toBe("/h-2400.webp");
  });
});

describe("script drop rule", () => {
  it("drops a script that calls the API or loads Turnstile (known bad)", () => {
    expect(dropReason('fetch(`/api/ask`,{method:"POST"})')).toBe("calls /api/");
    expect(dropReason('s.src="https://challenges.cloudflare.com/turnstile/v0/api.js"')).toBe("loads Turnstile");
  });

  it("keeps a script that only touches the page (known clean)", () => {
    expect(dropReason('document.querySelector(".menu-toggle").hidden=false')).toBeNull();
  });

  it("escapes a closing tag inside inline code", () => {
    expect(safeInline('a="</script>"', "script")).toBe('a="<\\/script>"');
  });
});

describe("script types, as the HTML spec reads them", () => {
  it("treats no type, an empty type and every JavaScript MIME type as a classic script", () => {
    expect(scriptKind(null)).toBe("classic");
    expect(scriptKind("")).toBe("classic");
    expect(scriptKind("application/javascript")).toBe("classic");
    expect(scriptKind(" Text/JavaScript ")).toBe("classic");
    expect(scriptKind("text/x-ecmascript")).toBe("classic");
    expect(scriptKind(null, "JavaScript")).toBe("classic");
  });

  it("trims and lowercases module, so ' module' and 'MODULE' are still modules", () => {
    expect(scriptKind(" module")).toBe("module");
    expect(scriptKind("MODULE ")).toBe("module");
  });

  it("leaves data blocks alone: JSON, JSON-LD and a MIME type with parameters never run", () => {
    expect(scriptKind("application/json")).toBe("data");
    expect(scriptKind("application/ld+json")).toBe("data");
    expect(scriptKind("text/javascript; charset=utf-8")).toBe("data");
  });
});

describe("bundling stays inside the build", () => {
  const dist = path.join(scratch, "bundle/site/dist");
  // As in the real repo: site/tsconfig.json extends Astro's strict config, which
  // esbuild reads when it resolves the entry itself, so chunks keep strict mode.
  put("bundle/site/tsconfig.json", JSON.stringify({ compilerOptions: { strict: true } }));
  put("bundle/site/secret.json", '{"token":"climb-secret"}');
  put("bundle/secret.json", '{"token":"root-secret"}');
  put("bundle/site/dist/_astro/helper.js", 'export const h = "helper-ok";');
  const ok = put("bundle/site/dist/_astro/ok.js", 'import { h } from "./helper.js"; console.log(h);');
  const rooted = put("bundle/site/dist/_astro/rooted.js", 'import { h } from "/_astro/helper.js"; console.log(h);');
  const climb = put("bundle/site/dist/_astro/climb.js", 'import s from "../../secret.json"; console.log(s);');
  const root = put("bundle/site/dist/_astro/root.js", 'import s from "/../../secret.json"; console.log(s);');
  symlinkSync(path.join(scratch, "bundle/secret.json"), path.join(dist, "_astro/link.json"));
  const viaLink = put("bundle/site/dist/_astro/via-link.js", 'import s from "./link.json"; console.log(s);');

  it("bundles a chunk's relative and root-relative imports (known clean)", async () => {
    expect(await bundle(esbuild, { file: ok }, dist)).toContain("helper-ok");
    expect(await bundle(esbuild, { file: rooted }, dist)).toContain("helper-ok");
  });

  it("refuses a ../ climb out of the build (known bad)", async () => {
    await expect(bundle(esbuild, { file: climb }, dist)).rejects.toThrow(/outside the build/);
  });

  it("refuses a /../ root path out of the build (known bad)", async () => {
    await expect(bundle(esbuild, { file: root }, dist)).rejects.toThrow(/outside the build/);
    await expect(bundle(esbuild, { code: 'import s from "/../../secret.json"; console.log(s);' }, dist)).rejects.toThrow(
      /outside the build/,
    );
  });

  it("refuses a symlink inside the build that points out of it (known bad)", async () => {
    await expect(bundle(esbuild, { file: viaLink }, dist)).rejects.toThrow(/outside the build/);
  });

  it("refuses a file pulled in through a directory's package.json main (the load-time check)", async () => {
    put("bundle/site/dist/_astro/pkg/package.json", JSON.stringify({ main: "../../../secret.json" }));
    const viaMain = put("bundle/site/dist/_astro/via-main.js", 'import s from "./pkg"; console.log(s);');
    await expect(bundle(esbuild, { file: viaMain }, dist)).rejects.toThrow(/outside the build/);
  });

  it("keeps esbuild's own entry resolution, so the site's strict tsconfig still applies", async () => {
    expect(await bundle(esbuild, { file: ok }, dist)).toMatch(/^"use strict";/);
  });

  it("refuses a bare package import, which no built chunk makes", async () => {
    await expect(bundle(esbuild, { code: 'import "left-pad";' }, dist)).rejects.toThrow(/bare import/);
  });
});

describe("guide images", () => {
  const root = path.join(scratch, "repo");
  const guides = path.join(root, "ops/artifacts");
  put("repo/site/public/brand/logo.png");
  put("repo/site/src/assets/art/agents/resourcus.webp");
  put("repo/site/.dev.vars", "TURNSTILE_SECRET_KEY=not-a-real-key");
  put("repo/site/public/data.json", "{}");
  put("repo/site/public/.well-known/badge.png");
  put("repo/other/elsewhere.png");

  it("inlines the site's own published images (known clean)", () => {
    expect(docImageFile("../../site/public/brand/logo.png", guides, root).file).toBe(
      path.join(root, "site/public/brand/logo.png"),
    );
    expect(docImageFile("../../site/src/assets/art/agents/resourcus.webp", guides, root).file).not.toBeNull();
  });

  it("refuses site/.dev.vars and any file outside the two folders (known bad)", () => {
    expect(docImageFile("../../site/.dev.vars", guides, root)).toEqual({ file: null, reason: "outside site/public and site/src/assets" });
    expect(docImageFile("../../site/public/../.dev.vars", guides, root).file).toBeNull();
    expect(docImageFile("../../other/elsewhere.png", guides, root).file).toBeNull();
  });

  it("refuses a dot folder and a file that is not an image (known bad)", () => {
    expect(docImageFile("../../site/public/.well-known/badge.png", guides, root).reason).toBe("a dotfile");
    expect(docImageFile("../../site/public/data.json", guides, root).reason).toBe("not an image");
    expect(docImageFile("../../site/public/missing.png", guides, root).reason).toBe("missing");
  });

  it("accepts the logo the brand guide actually uses", () => {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    expect(docImageFile("../../site/public/brand/cs-logo-240.png", path.join(repo, "ops/artifacts")).file).not.toBeNull();
  });
});

describe("unlisted pages", () => {
  const pages = { pages: [{ file: "index.html" }, { file: "team/index.html" }] };
  for (const name of ["listed", "extra"]) {
    put(`${name}/index.html`);
    put(`${name}/team/index.html`);
    put(`${name}/_astro/chunk.html`);
    put(`${name}/pagefind/fragment.html`);
  }
  put("extra/new-route/index.html");

  it("finds nothing when every built page is in the manifest (known clean)", () => {
    expect(unlistedPages(path.join(scratch, "listed"), pages)).toEqual([]);
  });

  it("names a built page the manifest is missing (known bad)", () => {
    expect(unlistedPages(path.join(scratch, "extra"), pages)).toEqual(["new-route/index.html"]);
  });
});

describe("brand guide fills", () => {
  const color = { ground: "#FFFBF3", text: "#2B1D12", "new-thing": "#123456" };

  it("puts a color with no group under Other instead of dropping it", () => {
    const html = paletteHtml({ color, roles: { "new-thing": "a token added later" } });
    expect(html).toContain("Daylight and stone");
    expect(html).toContain(">Other<");
    expect(html).toContain("--c-new-thing");
    expect(html).toContain("a token added later");
  });

  it("draws a ring for a UI pairing and text for a body pairing", () => {
    const html = contrastHtml({
      color,
      contrast: [
        { fg: "text", bg: "ground", ratio: 15.81, min: 4.5 },
        { fg: "text", bg: "ground", ratio: 15.81, min: 3 },
      ],
    });
    expect(html.match(/pair__aa/g)).toHaveLength(1);
    expect(html.match(/pair__ring/g)).toHaveLength(1);
    expect(html).toContain("15.81:1");
  });

  it("flags a pairing at its floor and leaves a roomy one alone", () => {
    expect(nearMinimum(3, 3)).toBe(true);
    expect(nearMinimum(15.81, 4.5)).toBe(false);
    const html = contrastHtml({ color, contrast: [{ fg: "text", bg: "ground", ratio: 3, min: 3 }] });
    expect(html).toContain("pair--close");
  });
});

describe("brand guide fills from art/DIRECTION.md", () => {
  const md = [
    "# Title",
    "## Models (decision 88)",
    "| Job | Model |",
    "| --- | --- |",
    "| New images | `api_x` & **FIBO** |",
    "",
    "Prose after the table.",
    "## Motion",
    "1. **Animate the still.** From `i2v`.",
    "2. Keep it <quiet>.",
    "## Next",
  ].join("\n");

  it("finds a section by its heading's prefix and stops at the next heading", () => {
    expect(mdSection(md, "Models")).toContain("New images");
    expect(mdSection(md, "Models")).not.toContain("Animate");
    expect(mdSection(md, "Gone")).toBeNull();
  });

  it("renders a table's header and rows, escaped, with code and bold", () => {
    const html = mdTableHtml(mdSection(md, "Models") ?? "");
    expect(html).toContain('<th scope="col">Job</th>');
    expect(html).toContain("<td><code>api_x</code> &amp; <strong>FIBO</strong></td>");
    expect(html).not.toContain("---");
    expect(html).not.toContain("Prose");
  });

  it("returns null for a section left with no table rows", () => {
    expect(mdTableHtml("Prose only.\n| Job | Model |\n| --- | --- |")).toBeNull();
  });

  it("reads the vocabulary table the brand guide asks for from the real file", () => {
    const real = readFileSync(path.join(ROOT, "art/DIRECTION.md"), "utf8");
    const section = mdSection(real, "The vocabulary of the Hall");
    expect(section).not.toBeNull();
    expect(mdTableHtml(section ?? "")).toContain("Town main streets");
  });
});

describe("manifest", () => {
  const all = [...manifest.pages, ...manifest.docs];

  it("gives every page and guide a unique slug and file", () => {
    expect(new Set(all.map((e) => e.slug)).size).toBe(all.length);
    expect(new Set(all.map((e) => e.file)).size).toBe(all.length);
  });

  it("titles every page copy 'Hall: <page>'", () => {
    for (const page of manifest.pages) expect(page.title, page.file).toMatch(/^Hall: \S/);
  });

  it("points each guide at a source file that exists", () => {
    for (const doc of manifest.docs) expect(existsSync(path.join(ROOT, doc.file)), doc.file).toBe(true);
  });

  it("records only claude.ai Artifact links", () => {
    for (const entry of all) {
      if (entry.url !== null) expect(entry.url, entry.slug).toMatch(/^https:\/\/claude\.ai\/code\/artifact\/[0-9a-f-]{36}$/);
    }
  });
});

// #551: a build stamp says when the page was built, not that a hand-written
// fact was checked. Hand-written facts carry the commit that last changed them.
describe("guide stamps", () => {
  it("never pairs a claim of checking with the build stamp", () => {
    for (const doc of manifest.docs) {
      const html = readFileSync(path.join(ROOT, doc.file), "utf8");
      expect(html, doc.file).not.toMatch(/(checked against|read from) the repo at <!-- l16:built -->/i);
    }
  });

  it("stamps the keepers guide's facts with the commit that last changed it", () => {
    const html = readFileSync(path.join(ROOT, "ops/artifacts/keepers.html"), "utf8");
    expect(html).toContain("Written by hand at <!-- l16:written -->");
    expect(writtenCommit("ops/artifacts/keepers.html")).toMatch(/^[0-9a-f]{7,} \d{4}-\d{2}-\d{2}(, edited since)?$/);
    expect(writtenCommit("ops/artifacts/no-such-guide.html")).toBe("an uncommitted draft");
  });
});
