// Sort rules for the board's sort island. Pure, so the order a visitor sees is
// unit-tested without a browser. The island (components/leaderboard/
// HonoreesTable.astro) only moves rows and sets aria-sort.

export type SortKind = "text" | "number";
export type SortDirection = "ascending" | "descending";

/**
 * Compare two cell sort values. Empty values (an unknown founding year, say)
 * always sort last, in both directions, so blanks never crowd the top.
 */
export function compareCells(a: string, b: string, kind: SortKind, direction: SortDirection): number {
  const aEmpty = a.trim() === "";
  const bEmpty = b.trim() === "";
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  const sign = direction === "ascending" ? 1 : -1;
  if (kind === "number") return sign * (Number(a) - Number(b));
  return sign * a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
}

/** The direction a column takes on click: toggle if it is current, else ascending. */
export function nextDirection(current: SortDirection | null): SortDirection {
  return current === "ascending" ? "descending" : "ascending";
}

/**
 * Indices of `values` in sorted order. Stable: equal values keep their current
 * relative order (Array.prototype.sort is stable), so a secondary order the
 * visitor already chose survives.
 */
export function sortedOrder(values: readonly string[], kind: SortKind, direction: SortDirection): number[] {
  return values.map((_, i) => i).sort((i, j) => compareCells(values[i]!, values[j]!, kind, direction));
}
