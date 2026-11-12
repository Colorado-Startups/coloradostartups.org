// Small text helpers shared across pages and figures.

/** "Boulder, Golden, Arvada and Denver": the house list style, no serial comma. */
export function andList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
