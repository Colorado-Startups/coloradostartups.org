// L38: the seat pages' text helpers. The keeper disclosure on kit copy, the
// bar widths, the footnote numbering and the page head.
import { describe, expect, it } from "vitest";

import { barWidths, figureNumber, withKeeperDisclosure } from "../../../src/lib/seats/copy";
import { SEAT_LAYOUTS, SECTION_KICKERS, SECTION_ORDER, layoutRefs } from "../../../src/lib/seats/layouts";
import { loadCommon, loadFacts, loadSeats, parseHours, seatCourses, type Fact } from "../../../src/lib/seats/load";
import { formatHours, seatPageDescription, seatPageTitle } from "../../../src/lib/seats/page";
import { COURSES_REF, factSentence, numberSources, readDate } from "../../../src/lib/seats/sources";

describe("withKeeperDisclosure", () => {
  it("adds the words to a sentence that names Communitas without them (known bad, from roles.json)", () => {
    expect(withKeeperDisclosure("People moderate this Slack. Communitas never does, so the judgment calls are yours.")).toBe(
      "People moderate this Slack. Communitas, an AI agent, never does, so the judgment calls are yours.",
    );
  });

  it("leaves a sentence that already says AI agent, or names no keeper, as it was (known clean)", () => {
    const said = "Work beside Communitas, the AI agent that greets new members, and tell us where it gets things wrong.";
    expect(withKeeperDisclosure(said)).toBe(said);
    expect(withKeeperDisclosure("Everyone is welcome.")).toBe("Everyone is welcome.");
  });

  it("handles a keeper at the end of a sentence, and the other two keepers", () => {
    expect(withKeeperDisclosure("Say hello to Communitas.")).toBe("Say hello to Communitas, an AI agent.");
    expect(withKeeperDisclosure("Resourcus answers from the map.")).toBe("Resourcus, an AI agent, answers from the map.");
  });
});

describe("bar widths", () => {
  it("charts percentages against 100", () => {
    expect(barWidths(["92%", "82%"])).toEqual([92, 82]);
  });

  it("charts other figures against the largest", () => {
    expect(barWidths(["86,458", "143,807"])).toEqual([60.1, 100]);
    expect(barWidths(["24", "18", "13"])).toEqual([100, 75, 54.2]);
  });

  it("reads money, magnitudes and a trailing plus, and refuses words", () => {
    expect(figureNumber("$7.6 billion")).toBe(7.6e9);
    expect(figureNumber("220+")).toBe(220);
    expect(() => figureNumber("13th")).toThrow();
  });
});

describe("numberSources", () => {
  const f = (source: string, url: string): Fact => ({ value: "1%", label: "of a seeded sample (survey)", source, url, read: "2026-10-18", short: "survey" });
  const facts = {
    a: f("Survey A", "https://example.org/a"),
    b: f("Survey A", "https://example.org/a"),
    c: f("Survey C", "https://example.org/c"),
    d: f("Survey A", "https://example.org/other"),
  };
  const courses = [{ id: "claude-101" as const, title: "Claude 101", url: "https://academy.claude.com/courses/claude-101", length: "2.5 hours", hours: 2.5 }];

  it("numbers sources by first citation, and facts that share a source and link share one number", () => {
    const notes = numberSources(["c", "a", "b", COURSES_REF, "a", "d"], facts, courses, { course_lengths_read: "2026-10-18" });
    expect(["c", "a", "b", COURSES_REF, "d"].map((r) => notes.noteFor(r))).toEqual([1, 2, 2, 3, 4]);
    expect(notes.entries.map((e) => e.n)).toEqual([1, 2, 3, 4]);
    expect(notes.entries[1]!.facts.map((x) => x.id)).toEqual(["a", "b"]);
    expect(notes.entries[2]!.links).toEqual([{ text: "Claude 101", href: "https://academy.claude.com/courses/claude-101" }]);
  });

  it("refuses a fact the sync did not keep, and a ref the page never cited", () => {
    expect(() => numberSources(["newsletter-reach"], facts, courses, { course_lengths_read: "2026-10-18" })).toThrow(/not in/);
    expect(() => numberSources(["a"], facts, courses, { course_lengths_read: "2026-10-18" }).noteFor("c")).toThrow(/never cites/);
  });

  it("writes the read date in words, and each figure leading its own sentence", () => {
    expect(readDate("2026-10-18")).toBe("October 18, 2026");
    expect(readDate("2026-01-05")).toBe("January 5, 2026");
    expect(() => readDate("Oct 18")).toThrow(/not a date/);
    expect(() => readDate("2026-13-01")).toThrow(/not a date/);
    expect(() => readDate("2026-02-31")).toThrow(/not a date/);
    expect(() => readDate("2026-04-31")).toThrow(/not a date/);
    expect(readDate("2028-02-29")).toBe("February 29, 2028");
    expect(factSentence(facts.a)).toBe("1% of a seeded sample (survey).");
  });
});

describe("each seat page's order, sources and head", () => {
  const seats = loadSeats();
  const common = loadCommon();
  const facts = loadFacts();

  it("answers the kit README's five questions in order", () => {
    expect(SECTION_ORDER.map((k) => SECTION_KICKERS[k])).toEqual([
      "What you get",
      "How it grows your network",
      "How it helps Colorado",
      "Who we are looking for",
      "How to apply",
    ]);
  });

  it.each(seats.map((s) => [s.id, s] as const))("%s cites the course lengths once, after its figures", (id, seat) => {
    const refs = layoutRefs(SEAT_LAYOUTS[id as keyof typeof SEAT_LAYOUTS]);
    expect(refs.filter((r) => r === COURSES_REF)).toHaveLength(1);
    expect(refs[refs.length - 1]).toBe(COURSES_REF);
    const notes = numberSources(refs, facts, seatCourses(seat, common), common);
    expect(notes.entries.length).toBeGreaterThan(1);
  });

  it("never repeats roles.json's own words in a layout: the org lead, a perk, a step or a rule", () => {
    const layouts = JSON.stringify(SEAT_LAYOUTS);
    const kit = [common.org.lead, common.linkedin_rule, ...common.perks, ...common.look_for, ...common.rules_common];
    for (const line of [...kit, ...common.steps.map((s) => s.body)]) expect(layouts, line).not.toContain(line);
  });

  it("gives each page a unique title and description, each naming the seat and saying volunteer", () => {
    const titles = seats.map(seatPageTitle);
    const descriptions = seats.map(seatPageDescription);
    expect(new Set(titles).size).toBe(seats.length);
    expect(new Set(descriptions).size).toBe(seats.length);
    for (const [i, seat] of seats.entries()) {
      for (const text of [titles[i]!, descriptions[i]!]) {
        expect(text).toContain(seat.title);
        expect(text).toMatch(/volunteer/);
      }
    }
  });

  it("reads course lengths in hours, and totals them the way the kit writes hours", () => {
    expect(parseHours("2.5 hours")).toBe(2.5);
    expect(parseHours("45 minutes")).toBe(0.75);
    expect(() => parseHours("a while")).toThrow();
    expect(formatHours(2.5 + 4 + 0.75)).toBe("7.25");
    expect(formatHours(2.5 + 4 + 3.5)).toBe("10");
  });
});
