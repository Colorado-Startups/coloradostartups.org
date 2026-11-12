// What the two Workers bundle stays small (code.worker_bundle_kb, goal 150 KB
// gzipped). zod 4's `z` named export is an `export * as z` namespace, which
// esbuild cannot tree-shake: `import { z } from "zod"` ships every locale and
// the JSON Schema converters, about 60 KB gzipped per copy of zod. `import * as
// z from "zod"` is the same API and keeps only what the schemas call.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
// The source both Worker entry points reach: the site Worker, the shared
// contracts and the Communitas Worker.
const ROOTS = ["site/worker/", "packages/shared/src/", "workers/communitas/src/"];
const NAMED_Z = /\bimport\s*(?:type\s*)?\{[^}]*\bz\b[^}]*\}\s*from\s*["']zod(?:\/[^"']*)?["']/;

function sources(root: string): string[] {
  return readdirSync(path.join(REPO, root), { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.[cm]?ts$/.test(e.name) && !/\.test\./.test(e.name))
    .map((e) => path.relative(REPO, path.join(e.parentPath, e.name)).split(path.sep).join("/"));
}

describe("zod in the Workers", () => {
  it("catches the named import, and lets the namespace one through", () => {
    expect(NAMED_Z.test('import { z } from "zod";')).toBe(true);
    expect(NAMED_Z.test('import { type ZodType, z } from "zod/v4";')).toBe(true);
    expect(NAMED_Z.test('import * as z from "zod";')).toBe(false);
  });

  const files = ROOTS.flatMap(sources);

  it("reads every root", () => {
    for (const root of ROOTS) expect(files.some((f) => f.startsWith(root)), root).toBe(true);
  });

  it.each(files)("%s imports zod as a namespace", (file) => {
    expect(readFileSync(path.join(REPO, file), "utf8")).not.toMatch(NAMED_Z);
  });
});
