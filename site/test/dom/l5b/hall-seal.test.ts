import { describe, expect, it } from "vitest";

import { HALL_ART_ALT } from "../../../src/components/art/keepers";
import { readDist } from "../pages";

// L5b (#261): each text-only page closes with one Hall element, the small
// Great Hall picture the dispatch article ends with. Keepers appear in it, so
// its alt says they are AI agents (#714, .claude/rules/ai-disclosure.md). It
// loads lazily at the end of the page. Built HTML from dist/ (run
// `npm run build` first).

const PAGES = [
  "newsletter/thanks/index.html",
  "leaderboard/nominate/thanks/index.html",
  "get-involved/apply/thanks/index.html",
  "ecosystem-canvas/suggest/thanks/index.html",
  "get-involved/apply/index.html",
  "leaderboard/nominate/index.html",
];

describe.each(PAGES)("%s", (file) => {
  const main = new DOMParser().parseFromString(readDist(file), "text/html").querySelector("main")!;

  it("closes with one Hall picture that discloses its keepers, after the page's last action", () => {
    const seals = [...main.querySelectorAll<HTMLElement>("figure.hall-seal")];
    expect(seals).toHaveLength(1);
    const seal = seals[0]!;
    expect(seal.dataset.art).toBe("hero/hall");
    const img = seal.querySelector("img");
    expect(img, "the art file exists, so no placeholder").not.toBeNull();
    expect(img!.getAttribute("alt")).toBe(HALL_ART_ALT);
    expect(img!.getAttribute("alt")).toMatch(/AI agent/);
    expect(img!.getAttribute("loading")).toBe("lazy");
    const last = [...main.querySelectorAll(".btn-row, form")].at(-1)!;
    expect(last.compareDocumentPosition(seal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
