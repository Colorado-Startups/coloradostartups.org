import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// L14's Modal pipeline is Python (ops/gpu/modal/). Its tests live beside it in
// test_workflow.py; this file only runs them, so they fire on pre-push and in
// CI with the rest of the unit project. A missing python3 is an
// infrastructure problem, not a failure, so the test is skipped with a note.

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const python = process.env.CS_SITE_PYTHON ?? "python3";
const probe = spawnSync(python, ["--version"], { encoding: "utf8" });
const hasPython = probe.status === 0;

describe("L14 GPU pipeline (python unittest)", () => {
  it.skipIf(!hasPython)("ops/gpu/modal tests pass", () => {
    const run = spawnSync(python, ["-m", "unittest", "discover", "-s", "ops/gpu/modal"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
  });
});
