// L15: BaseLayout's JSON-LD cannot close its own <script> tag. jsonLdText()
// in src/layouts/json-ld.ts is the one definition, and BaseLayout calls it.
// The HTML parser ends a script element's text at "</script" in any letter
// case, so the check is that the text holds no "<" at all and still parses to
// the same value. test/dom/l15/head.test.ts runs a real HTML parser over it.
import { describe, expect, it } from "vitest";

import { jsonLdText } from "../../../src/layouts/json-ld";
import { ATTACK, CLEAN } from "./json-ld-samples";

describe("jsonLdText", () => {
  it("self-test: the known-bad sample does carry a closing tag before escaping", () => {
    // If this fails, the sample no longer proves anything below.
    expect(JSON.stringify(ATTACK)).toMatch(/<\/script/i);
    expect(JSON.stringify(ATTACK)).toContain("<!--");
  });

  it("leaves no '<' in the text, so no '</script' and no '<!--'", () => {
    const out = jsonLdText(ATTACK);
    expect(out).not.toContain("<");
    expect(out).not.toMatch(/<\/script/i);
  });

  it("parses back to the same value", () => {
    expect(JSON.parse(jsonLdText(ATTACK))).toEqual(ATTACK);
  });

  it("changes nothing in the known-clean sample", () => {
    expect(jsonLdText(CLEAN)).toBe(JSON.stringify(CLEAN));
  });
});
