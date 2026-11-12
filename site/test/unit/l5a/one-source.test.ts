import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// L5a, card "Shared CSS patterns" (#195): a look the design system already
// names is not written again. The Badge replaced the v1 .chip tag, and the
// --sh-ledge tokens replaced raw ledge shadows.

const SITE = path.join(__dirname, "../../..");

/** Lines under site/src that match `pattern`, as "file:line: text". */
function grep(pattern: string): string[] {
  try {
    return execFileSync("git", ["grep", "-n", "-E", "-e", pattern, "--", "src"], { cwd: SITE, encoding: "utf8" }).trim().split("\n");
  } catch {
    return []; // git grep exits 1 when nothing matches
  }
}

describe("one source for small pieces", () => {
  it("the grep finds a known pattern (self-test)", () => {
    expect(grep("--sh-ledge:").length).toBeGreaterThan(0);
  });

  it("has no .chip rule or class left; a tag is a Badge", () => {
    expect(grep(String.raw`\.chip\b|class="chip"`)).toEqual([]);
  });

  it("draws every solid ledge with a --sh-ledge token, not a raw 4 px shadow", () => {
    expect(grep(String.raw`0 4px 0 var\(--c-`)).toEqual([]);
  });

  it("has the footer read the address, the tagline and the list join from their one home (#706)", () => {
    const footer = readFileSync(path.join(SITE, "src/components/ui/SiteFooter.astro"), "utf8");
    for (const copy of ["951 20th Street", "A community of founders building companies in Colorado", 'join(", ")']) {
      expect(footer, copy).not.toContain(copy);
    }
    for (const helper of ["andList(", "{TAGLINE}", "POSTAL_ADDRESS.map("]) expect(footer, helper).toContain(helper);
  });
});

describe("Resourcus panel spacing (#723)", () => {
  it("sets the AI note apart from the form with --s-5", () => {
    const panel = readFileSync(path.join(SITE, "src/components/resourcus/ResourcusPanel.astro"), "utf8");
    expect(panel).toMatch(/\.resourcus \.ai-note \{\s*margin-top: var\(--s-5\);\s*\}/);
  });
});
