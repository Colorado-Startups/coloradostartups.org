// File order for the keepers and the people on /team/. getCollection()
// returns a file() collection sorted by id, but for these two files the YAML
// order is the editorial order: Communitas, Resourcus, Publicus; Micah before
// Lindsey, as in the Oct 6 note. Vite inlines the raw files at build time, so
// this reads the same files the collections load. Positions are not ordered
// here: comparePositions() in @cs/shared sorts them on every page.
import { parse } from "yaml";

import dwarvesRaw from "../../../../data/team/dwarves.yaml?raw";
import peopleRaw from "../../../../data/team/people.yaml?raw";

const idsOf = (raw: string): string[] => (parse(raw) as { id: string }[]).map((entry) => entry.id);

const ORDER = {
  dwarves: idsOf(dwarvesRaw),
  people: idsOf(peopleRaw),
};

/** Returns a copy of `items` in the order their ids appear in data/team/<file>.yaml. */
export function inFileOrder<T extends { id: string }>(file: keyof typeof ORDER, items: readonly T[]): T[] {
  const rank = new Map(ORDER[file].map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}
