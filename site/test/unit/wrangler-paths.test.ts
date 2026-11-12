// Every Worker source file site/wrangler.jsonc names, in a comment or a
// value, exists. #317: a comment kept naming worker/lib/email.ts after #278
// folded it into notify.ts.
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const SITE = new URL("../../", import.meta.url);
const PATH = /\bworker\/[\w./-]+\.ts\b/g;

describe("site/wrangler.jsonc", () => {
  const named = [...new Set(readFileSync(new URL("wrangler.jsonc", SITE), "utf8").match(PATH) ?? [])];

  it("finds the paths it names, and refuses one that does not exist", () => {
    expect(named).toContain("worker/index.ts");
    expect("see worker/lib/gone.ts".match(PATH)).toEqual(["worker/lib/gone.ts"]);
    expect(existsSync(new URL("worker/lib/gone.ts", SITE))).toBe(false);
  });

  it.each(named)("names %s, which exists", (path) => {
    expect(existsSync(new URL(path, SITE)), path).toBe(true);
  });
});
