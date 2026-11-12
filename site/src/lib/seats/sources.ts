// Footnotes and the Sources list for the seat pages (lane L38). Every figure
// on a seat page is a fact from data/positions/facts.yaml, and the course
// lengths come from Claude Academy's course pages. Sources are numbered in
// the order a page first cites them. Facts that share a source and a link
// share one number and one entry, and each figure leads its own sentence in
// that entry, as the volunteer kit's {{sources}} token lays them out.
import { factById, type Common, type Fact, type SeatCourse } from "./load";

/** The ref a page cites for its course lengths and total hours. */
export const COURSES_REF = "courses";

export interface SourceEntry {
  n: number;
  /** Facts in this entry, in the order the page cites them; empty for the course entry. */
  facts: { id: string; fact: Fact }[];
  /** Linked source name(s): one for a fact source, one per course for the course entry. */
  links: { text: string; href: string }[];
  /** A lead-in before the links, such as "Course lengths". */
  lead?: string;
  read: string;
}

export interface Footnotes {
  /** The footnote number for a fact id or COURSES_REF. Throws for a ref the page never cited. */
  noteFor(ref: string): number;
  entries: SourceEntry[];
}

const sourceKey = (fact: Fact) => `${fact.source}\n${fact.url}`;

/**
 * Numbers the sources a page cites, in order of first citation. `refs` lists
 * fact ids and COURSES_REF in page order; repeats are fine.
 */
export function numberSources(
  refs: readonly string[],
  facts: Readonly<Record<string, Fact>>,
  courses: readonly SeatCourse[],
  common: Pick<Common, "course_lengths_read">,
): Footnotes {
  const byKey = new Map<string, SourceEntry>();
  const noteOf = new Map<string, number>();
  for (const ref of refs) {
    if (noteOf.has(ref)) continue;
    if (ref === COURSES_REF) {
      const entry: SourceEntry = {
        n: byKey.size + 1,
        facts: [],
        lead: "Course lengths, from Claude Academy's course pages",
        links: courses.map((c) => ({ text: c.title, href: c.url })),
        read: common.course_lengths_read,
      };
      byKey.set(COURSES_REF, entry);
      noteOf.set(ref, entry.n);
      continue;
    }
    const fact = factById(facts, ref);
    const key = sourceKey(fact);
    let entry = byKey.get(key);
    if (!entry) {
      entry = { n: byKey.size + 1, facts: [], links: [{ text: fact.source, href: fact.url }], read: fact.read };
      byKey.set(key, entry);
    }
    entry.facts.push({ id: ref, fact });
    noteOf.set(ref, entry.n);
  }
  return {
    noteFor(ref) {
      const n = noteOf.get(ref);
      if (n === undefined) throw new Error(`no footnote for "${ref}": the page never cites it`);
      return n;
    },
    entries: [...byKey.values()],
  };
}

/** "2026-10-18" as "October 18, 2026", read in UTC so no time zone shifts the day. */
export function readDate(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  // A day past the month's end would roll over ("2026-02-31" is March 3), so the day must come back unchanged.
  const real = /^\d{4}-\d{2}-\d{2}$/.test(day) && date.getUTCDate() === Number(day.slice(8));
  if (!real) throw new Error(`not a date: "${day}"`);
  return date.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
}

/** A fact's own sentence in the Sources list: the figure, then its label. */
export function factSentence(fact: Fact): string {
  return `${fact.value} ${fact.label}.`;
}
