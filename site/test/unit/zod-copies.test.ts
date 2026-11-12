// One copy of zod in the install (#617). Two copies bundle twice into each
// Worker, and a schema from @cs/shared is then checked by another zod than
// the code that reads its result. #600 split it by moving the workspaces to
// ^4.6.7 while @cloudflare/vitest-plugin pinned 4.6.6; the root package.json
// override holds every package to one version.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const LOCK = JSON.parse(readFileSync(new URL("../../../package-lock.json", import.meta.url), "utf8")) as {
  packages: Record<string, { version?: string }>;
};

describe("package-lock.json", () => {
  it("installs zod once, at the root", () => {
    const copies = Object.keys(LOCK.packages).filter((p) => p === "node_modules/zod" || p.endsWith("/node_modules/zod"));
    expect(copies).toEqual(["node_modules/zod"]);
  });
});
