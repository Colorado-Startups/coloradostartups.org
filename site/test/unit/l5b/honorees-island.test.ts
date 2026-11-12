// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { initHonoreesTables } from "../../../src/components/leaderboard/honorees-table-client";

// L5b: the honorees table's island, run in jsdom on the markup HonoreesTable
// renders (trimmed to three rows). It sorts by a column and filters by
// sector, then a reset shows every row again.

const row = (id: string, name: string, desc: string, sector: string, city: string) => `
  <tr id="company-${id}" data-sector="${sector}" data-city="${city}">
    <th scope="row" data-sort="${name}"><a href="#">${name}</a><span class="desc">${desc}</span></th>
    <td data-sort="${sector}">${sector}</td><td data-sort="${city}">${city}</td><td data-sort="Overall">Overall</td><td></td>
  </tr>`;

beforeEach(() => {
  document.body.innerHTML = `
    <div data-sortable-table>
      <form data-honoree-filters hidden>
        <input name="q" /><select name="sector"><option value="">All</option><option>Software</option><option>Space</option></select>
        <select name="city"><option value="">All</option><option>Boulder</option><option>Denver</option></select>
        <button type="reset">Clear filters</button>
      </form>
      <table><thead><tr>
        <th data-kind="text" aria-sort="ascending"><button type="button" data-col="0">Company</button></th>
        <th data-kind="text"><button type="button" data-col="1">Sector</button></th>
        <th data-kind="text"><button type="button" data-col="2">HQ city</button></th>
        <th data-kind="text"><button type="button" data-col="3">Boards</button></th><th>Sources</th>
      </tr></thead><tbody>
        ${row("a", "Acme", "Makes rockets.", "Space", "Boulder")}
        ${row("b", "Beta", "Builds software for clinics.", "Software", "Denver")}
        ${row("c", "Cora", "Builds data tools.", "Software", "Boulder")}
      </tbody></table>
      <p data-sort-status></p>
    </div>`;
  initHonoreesTables(document);
});

const names = () => [...document.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("a")?.textContent);
const shown = () => [...document.querySelectorAll<HTMLTableRowElement>("tbody tr")].filter((tr) => !tr.hidden).length;
const status = () => document.querySelector("[data-sort-status]")?.textContent;

describe("initHonoreesTables", () => {
  it("shows the filter form once it runs", () => {
    expect(document.querySelector<HTMLFormElement>("[data-honoree-filters]")!.hidden).toBe(false);
  });

  it("sorts by a column and marks it", () => {
    const company = document.querySelector<HTMLButtonElement>('button[data-col="0"]')!;
    company.click();
    expect(names()).toEqual(["Cora", "Beta", "Acme"]);
    expect(company.closest("th")!.getAttribute("aria-sort")).toBe("descending");
    document.querySelector<HTMLButtonElement>('button[data-col="2"]')!.click();
    expect(company.closest("th")!.hasAttribute("aria-sort")).toBe(false);
    expect(status()).toBe("Sorted by HQ city, ascending.");
  });

  it("filters by sector and search, and a reset shows every row", async () => {
    const form = document.querySelector<HTMLFormElement>("[data-honoree-filters]")!;
    form.querySelector<HTMLSelectElement>('select[name="sector"]')!.value = "Software";
    form.dispatchEvent(new Event("input"));
    expect(shown()).toBe(2);
    expect(status()).toBe("Showing 2 of 3 companies.");

    form.querySelector<HTMLInputElement>('input[name="q"]')!.value = "clinics";
    form.dispatchEvent(new Event("input"));
    expect(shown()).toBe(1);

    form.reset();
    await new Promise((r) => setTimeout(r, 0));
    expect(shown()).toBe(3);
    expect(status()).toBe("Showing all 3 companies.");
  });
});
