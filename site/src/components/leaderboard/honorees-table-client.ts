// The honorees table's island, moved out of HonoreesTable.astro so the
// component stays under 300 code lines (code.long_files). Column sorting:
// buttons in the headers, aria-sort on the active column. The filter: search,
// sector and HQ city (#145). The component calls it once for the page.
import { nextDirection, sortedOrder, type SortDirection, type SortKind } from "../../lib/leaderboard/sort";
import { honoreeCount, matchesHonoree } from "./honorees-filter";

/** Wires sorting and the filter on every [data-sortable-table] in `doc`. */
export function initHonoreesTables(doc: Document): void {
  for (const root of doc.querySelectorAll<HTMLElement>("[data-sortable-table]")) {
    const table = root.querySelector("table")!;
    const tbody = table.tBodies[0]!;
    const headers = [...table.tHead!.rows[0]!.cells].filter((th) => th.querySelector("button[data-col]"));
    const status = root.querySelector<HTMLElement>("[data-sort-status]");

    for (const th of headers) {
      const button = th.querySelector<HTMLButtonElement>("button[data-col]")!;
      button.addEventListener("click", () => {
        const col = Number(button.dataset.col);
        const kind = (th.dataset.kind ?? "text") as SortKind;
        const current = th.getAttribute("aria-sort") as SortDirection | null;
        const direction = nextDirection(current);
        const rows = [...tbody.rows];
        const values = rows.map((r) => r.cells[col]?.dataset.sort ?? "");
        for (const i of sortedOrder(values, kind, direction)) tbody.appendChild(rows[i]!);
        for (const other of headers) other.removeAttribute("aria-sort");
        th.setAttribute("aria-sort", direction);
        if (status) status.textContent = `Sorted by ${button.textContent?.trim()}, ${direction}.`;
      });
    }

    // The filter form waits hidden until this runs: without JavaScript it
    // could do nothing, and the table is complete without it.
    const form = root.querySelector<HTMLFormElement>("[data-honoree-filters]");
    if (form) {
      const rows = [...tbody.rows].map((tr) => ({
        tr,
        facts: {
          name: tr.cells[0]?.querySelector("a")?.textContent ?? "",
          description: tr.cells[0]?.querySelector(".desc")?.textContent ?? "",
          sector: tr.dataset.sector ?? "",
          city: tr.dataset.city ?? "",
        },
      }));
      const apply = () => {
        const data = new FormData(form);
        const filters = { q: String(data.get("q") ?? ""), sector: String(data.get("sector") ?? ""), city: String(data.get("city") ?? "") };
        let shown = 0;
        for (const { tr, facts } of rows) {
          const show = matchesHonoree(facts, filters);
          tr.hidden = !show;
          if (show) shown++;
        }
        if (status) status.textContent = honoreeCount(shown, rows.length);
      };
      form.addEventListener("input", apply);
      form.addEventListener("submit", (e) => e.preventDefault());
      // A reset clears the fields after the event, so read them on the next turn.
      form.addEventListener("reset", () => setTimeout(apply));
      form.hidden = false;
    }
  }
}
