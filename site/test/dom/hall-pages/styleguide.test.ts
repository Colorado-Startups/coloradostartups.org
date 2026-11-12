// /styleguide/ over the built site (run `npm run build` first; test:content
// does). #254: a 3:1 pairing is a UI color, so its sample is a shape with no
// text, and axe no longer scores a border color as text. #253: the link sample
// keeps the space before its link.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { readDist, SITE_DIR } from "../pages";

const doc = new DOMParser().parseFromString(readDist("styleguide/index.html"), "text/html");
const tokens = parse(readFileSync(path.join(SITE_DIR, "..", "01_doctrine/brand_tokens.yaml"), "utf8")) as {
  contrast: { fg: string; bg: string; min: number }[];
};

describe("/styleguide/ contrast table (#254)", () => {
  const rows = [...doc.querySelectorAll(".sg-contrast tbody tr")];

  it("has one row per pairing in brand_tokens.yaml", () => {
    expect(rows).toHaveLength(tokens.contrast.length);
  });

  it("shows text pairings as Aa and border and focus pairings as a shape with no text", () => {
    rows.forEach((row, i) => {
      const pairing = tokens.contrast[i]!;
      const sample = row.querySelector(".sg-sample")!;
      const label = `${pairing.fg} on ${pairing.bg}`;
      if (pairing.min === 3) {
        expect(sample.hasAttribute("data-ui-sample"), label).toBe(true);
        expect(sample.textContent?.trim(), label).toBe("");
      } else {
        expect(sample.textContent?.trim(), label).toBe("Aa");
      }
    });
  });
});

describe("/styleguide/ type samples (#253)", () => {
  it("keeps the space before the link sample", () => {
    expect(doc.body.textContent?.replace(/\s+/g, " ")).toContain("Links look like this");
  });
});
