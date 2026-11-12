// Page polish, #255, over the built site (run `npm run build` first;
// test:content does). On wide screens each keeper card on /team/ sets its
// text in two columns: title, role and bio on the left, the lists and the
// disclosure on the right. The columns are two wrappers in source order, so
// the disclosure still closes the card for a screen reader (hard constraint
// 10). The breakpoint rule itself is checked in
// test/unit/page-polish/keeper-card-columns.test.ts.
import { describe, expect, it } from "vitest";

import { readDist } from "../pages";

const page = new DOMParser().parseFromString(readDist("team/index.html"), "text/html");
const cards = [...page.querySelectorAll<HTMLElement>("#keepers [data-keeper]")];
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("/team/ keeper cards in two columns (#255)", () => {
  it("renders the keeper cards", () => {
    expect(cards.length).toBeGreaterThan(0);
  });

  for (const card of cards) {
    describe(card.dataset.keeper!, () => {
      const body = card.querySelector(".keeper__text");
      const main = body?.querySelector(":scope > [data-keeper-main]");
      const side = body?.querySelector(":scope > [data-keeper-side]");

      it("holds the main column, then the side column, and nothing else", () => {
        expect([...(body?.children ?? [])]).toEqual([main, side]);
      });

      it("puts the title, role and bio in the main column", () => {
        expect(main?.querySelector(".keeper__title")).not.toBeNull();
        expect(main?.querySelector(".keeper__role")).not.toBeNull();
        expect(main?.querySelectorAll(":scope > p").length).toBe(3);
      });

      it("puts the lists in the side column and ends it with the disclosure, visible", () => {
        expect(side?.querySelector(".keeper__lists")).not.toBeNull();
        const disclosure = side?.lastElementChild;
        expect(disclosure?.matches("[data-disclosure]")).toBe(true);
        expect(text(disclosure)).toContain("AI agent");
        expect(disclosure?.closest("[hidden], [aria-hidden='true'], .visually-hidden")).toBeNull();
      });

      it("keeps the disclosure as the last text of the card body", () => {
        expect(text(body).endsWith(text(side?.querySelector("[data-disclosure]")))).toBe(true);
      });
    });
  }
});
