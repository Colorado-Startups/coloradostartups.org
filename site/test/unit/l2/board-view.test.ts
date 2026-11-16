// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_VIEW,
  VIEW_KEY,
  initBoardView,
  parseView,
  readView,
  saveView,
  viewStatus,
} from "../../../src/components/leaderboard/board-view";
import { initHonoreesTables } from "../../../src/components/leaderboard/honorees-table-client";

// L3b: the Leaderboard's Table and Cards switch. One list, two layouts: the
// switch sets data-view on the board and saves the choice on this device.

/** A Storage stand-in; `fail` makes every call throw, as a blocked one does. */
function memoryStorage(fail = false) {
  const items = new Map<string, string>();
  return {
    items,
    getItem(key: string) {
      if (fail) throw new Error("blocked");
      return items.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (fail) throw new Error("blocked");
      items.set(key, value);
    },
  };
}

describe("parseView", () => {
  it("keeps table and cards, and turns anything else into the table", () => {
    expect(parseView("table")).toBe("table");
    expect(parseView("cards")).toBe("cards");
    for (const v of [null, undefined, "", "grid", "Cards", 1]) expect(parseView(v)).toBe("table");
    expect(DEFAULT_VIEW).toBe("table");
  });
});

describe("readView and saveView", () => {
  it("round-trips a choice under the one key", () => {
    const s = memoryStorage();
    expect(readView(s)).toBe("table");
    expect(saveView(s, "cards")).toBe(true);
    expect(s.items.get(VIEW_KEY)).toBe("cards");
    expect(readView(s)).toBe("cards");
  });

  it("falls back to the table when storage is missing, throws or holds junk", () => {
    expect(readView(null)).toBe("table");
    expect(readView(memoryStorage(true))).toBe("table");
    const junk = memoryStorage();
    junk.items.set(VIEW_KEY, "<script>");
    expect(readView(junk)).toBe("table");
  });

  it("reports a save that storage refuses, without throwing", () => {
    expect(saveView(null, "cards")).toBe(false);
    expect(saveView(memoryStorage(true), "cards")).toBe(false);
  });
});

describe("viewStatus", () => {
  it("says which layout now shows", () => {
    expect(viewStatus("cards")).toBe("Showing the companies as cards.");
    expect(viewStatus("table")).toBe("Showing the companies as a table.");
  });
});

const row = (id: string, name: string, sector: string) => `
  <tr id="company-${id}" data-sector="${sector}" data-city="Boulder" data-theme="other">
    <th scope="row" data-sort="${name}"><a href="#">${name}</a><span class="desc">Builds things.</span></th>
    <td data-sort="${sector}">${sector}</td><td data-sort="Boulder">Boulder</td><td data-sort="Overall">Overall</td><td></td>
  </tr>`;

function mount(): HTMLElement {
  document.body.innerHTML = `
    <div class="board" data-sortable-table data-view="table">
      <form data-honoree-filters hidden>
        <input type="radio" name="theme" value="" checked />
        <input name="q" /><select name="sector"><option value="">All</option><option>Software</option><option>Space</option></select>
        <select name="city"><option value="">All</option></select>
      </form>
      <div role="group" aria-label="Show the companies as" data-board-view hidden>
        <button type="button" data-view-option="table" aria-pressed="true">Table</button>
        <button type="button" data-view-option="cards" aria-pressed="false">Cards</button>
        <p aria-live="polite" data-view-status></p>
      </div>
      <table><thead><tr>
        <th data-kind="text" aria-sort="ascending"><button type="button" data-col="0">Company</button></th>
        <th data-kind="text"><button type="button" data-col="1">Sector</button></th>
        <th data-kind="text"><button type="button" data-col="2">HQ city</button></th>
        <th data-kind="text"><button type="button" data-col="3">Boards</button></th><th>Sources</th>
      </tr></thead><tbody>
        ${row("a", "Acme", "Space")}${row("b", "Beta", "Software")}${row("c", "Cora", "Software")}
      </tbody></table>
      <p data-sort-status></p>
    </div>`;
  return document.querySelector<HTMLElement>("[data-sortable-table]")!;
}

describe("initBoardView", () => {
  let board: HTMLElement;
  const button = (v: string) => board.querySelector<HTMLButtonElement>(`button[data-view-option="${v}"]`)!;
  const pressed = () => [button("table"), button("cards")].map((b) => b.getAttribute("aria-pressed"));

  beforeEach(() => {
    board = mount();
  });

  it("shows the switch once it runs, with nothing saved leaving the table", () => {
    initBoardView(board, memoryStorage());
    expect(board.querySelector<HTMLElement>("[data-board-view]")!.hidden).toBe(false);
    expect(board.dataset.view).toBe("table");
    expect(pressed()).toEqual(["true", "false"]);
  });

  it("switches to cards and back, pressing one button at a time and saving each choice", () => {
    const s = memoryStorage();
    initBoardView(board, s);
    button("cards").click();
    expect(board.dataset.view).toBe("cards");
    expect(pressed()).toEqual(["false", "true"]);
    expect(s.items.get(VIEW_KEY)).toBe("cards");
    expect(board.querySelector("[data-view-status]")?.textContent).toBe("Showing the companies as cards.");
    button("table").click();
    expect(board.dataset.view).toBe("table");
    expect(pressed()).toEqual(["true", "false"]);
    expect(s.items.get(VIEW_KEY)).toBe("table");
  });

  it("opens in the view this device saved", () => {
    const s = memoryStorage();
    s.items.set(VIEW_KEY, "cards");
    initBoardView(board, s);
    expect(board.dataset.view).toBe("cards");
    expect(pressed()).toEqual(["false", "true"]);
  });

  it("still switches when storage throws", () => {
    initBoardView(board, memoryStorage(true));
    button("cards").click();
    expect(board.dataset.view).toBe("cards");
  });

  // Same DOM: sorting and the filter act on the rows the cards show.
  it("keeps sort and filter working in the cards view, on the same rows", () => {
    initHonoreesTables(document);
    initBoardView(board, memoryStorage());
    button("cards").click();
    board.querySelector<HTMLButtonElement>('button[data-col="0"]')!.click();
    expect([...board.querySelectorAll("tbody tr")].map((tr) => tr.id)).toEqual(["company-c", "company-b", "company-a"]);
    const form = board.querySelector<HTMLFormElement>("[data-honoree-filters]")!;
    form.querySelector<HTMLSelectElement>('select[name="sector"]')!.value = "Space";
    form.dispatchEvent(new Event("input"));
    expect([...board.querySelectorAll<HTMLTableRowElement>("tbody tr")].filter((tr) => !tr.hidden).map((tr) => tr.id)).toEqual([
      "company-a",
    ]);
    expect(board.dataset.view).toBe("cards");
  });
});
