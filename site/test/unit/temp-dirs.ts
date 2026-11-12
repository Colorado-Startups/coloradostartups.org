import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach } from "vitest";

/**
 * A mkdtemp for tests whose folders are gone after each test, so a run leaves
 * nothing in TMPDIR (#332). Call it once at the top of a test file: the call
 * registers that file's afterEach. Make folders inside tests, never while a
 * describe block is collected, or the first afterEach removes a shared one.
 */
export function tempDirs(): (prefix: string) => string {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  return (prefix) => {
    const dir = mkdtempSync(path.join(tmpdir(), prefix));
    made.push(dir);
    return dir;
  };
}
