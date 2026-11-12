import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { buildLibrary, OUTPUT, renderLibrary, SOURCES } from "../../../../workers/communitas/scripts/library.mjs";

// The Communitas Worker cannot read YAML at runtime, so it bundles a generated
// JSON copy of data/communitas/*.yaml plus the dwarves' disclosures. This is
// the parity gate: the YAML is the one definition (and the copy the content
// lint checks), the JSON is generated, and this test fails when they drift.
// Fix: `node workers/communitas/scripts/sync-library.mjs`, never a hand edit.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("Communitas library parity", () => {
  it("the committed library.json matches the YAML sources", () => {
    const expected = renderLibrary(
      buildLibrary(
        {
          threadsYaml: read(SOURCES.threadsYaml),
          slackYaml: read(SOURCES.slackYaml),
          dwarvesYaml: read(SOURCES.dwarvesYaml),
        },
        parse,
      ),
    );
    expect(read(OUTPUT), "run: node workers/communitas/scripts/sync-library.mjs").toBe(expected);
  });

  it("self-test: a changed source is detected as drift", () => {
    const sources = {
      threadsYaml: read(SOURCES.threadsYaml),
      slackYaml: read(SOURCES.slackYaml).replace("keeper of the doors", "keeper of the gates"),
      dwarvesYaml: read(SOURCES.dwarvesYaml),
    };
    expect(renderLibrary(buildLibrary(sources, parse))).not.toBe(read(OUTPUT));
  });

  it("refuses to build when a dwarf disclosure is missing", () => {
    const dwarvesYaml = "- id: communitas\n  name: Communitas\n";
    expect(() =>
      buildLibrary({ threadsYaml: read(SOURCES.threadsYaml), slackYaml: read(SOURCES.slackYaml), dwarvesYaml }, parse),
    ).toThrow(/disclosure/);
  });
});
