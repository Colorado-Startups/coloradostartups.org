// /privacy/ over the built site (run `npm run build` first; test:content
// does). #245: The short version, the list under the first H2, sits in a
// panel with a Callout's look. The page styles it by position, so this test
// fails if the policy's first section stops being a heading and one list, or
// if the panel rule loses its face, gold rule or cut corners.
import { describe, expect, it } from "vitest";

import { readDist } from "../pages";
import { declFor, pageCss } from "./css";

const html = readDist("privacy/index.html");
const doc = new DOMParser().parseFromString(html, "text/html");
const css = pageCss(html);
const PANEL = ".prose h2:first-of-type + ul";

describe("/privacy/ The short version panel (#245)", () => {
  it("targets the list right under The short version", () => {
    const h2 = doc.querySelector(".prose h2");
    expect(h2?.textContent?.trim()).toBe("The short version");
    const list = h2?.nextElementSibling;
    expect(list?.tagName).toBe("UL");
    expect(doc.querySelector(".prose h2:first-of-type + ul")).toBe(list);
    expect(list?.querySelectorAll(":scope > li").length).toBeGreaterThan(0);
  });

  it("gives the list a surface face, a gold left rule and bevel corners", () => {
    expect(declFor(css, PANEL, "background")).toBe("var(--c-surface)");
    expect(declFor(css, PANEL, "border-left")).toBe("4px solid var(--c-accent)");
    expect(declFor(css, PANEL, "border-radius")).toBe("var(--r-bevel)");
    expect(declFor(css, PANEL, "corner-shape", "@supports (corner-shape:bevel)")).toBe("bevel");
  });
});
