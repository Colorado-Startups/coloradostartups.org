import { COURSE_TITLES, type CourseId } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { COURSE_MINUTES, courseLength } from "../../../src/components/positions/courses";
import { readDist } from "../pages";

// L5b (#146): a seat that takes applications shows its Claude Academy
// courses, linked and timed, and its card says who Paul is. Built HTML from
// dist/.

const doc = (rel: string) => new DOMParser().parseFromString(readDist(rel), "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

// On 2026-11-15 the course list left the seat cards (Paul: few words). Each
// card links its seat page, which lists the courses with their lengths
// (test/dom/l38/seats.test.ts), and the form lists them again.
describe("/get-involved/ seat cards that take applications", () => {
  const cards = [...doc("get-involved/index.html").querySelectorAll("main [data-position]")].filter((c) =>
    c.querySelector("a[data-apply]"),
  );

  it("exist", () => {
    expect(cards.length).toBeGreaterThan(0);
  });

  it("link the seat page, where the courses are, before the apply button", () => {
    for (const card of cards) {
      const page = card.querySelector("a[data-seat-page]")!;
      expect(page.getAttribute("href")).toBe(`/get-involved/${card.getAttribute("data-position")}/`);
      const apply = card.querySelector("a[data-apply]")!;
      expect(page.compareDocumentPosition(apply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("name Paul Foley as our founder, linked to /team/", () => {
    for (const card of cards) {
      const line = card.querySelector(".position__email-line")!;
      expect(line.querySelector('a[href="/team/"]')?.textContent).toBe("Paul Foley");
    }
  });
});

describe("/get-involved/apply/ course list", () => {
  it("gives each course its length", () => {
    for (const li of doc("get-involved/apply/index.html").querySelectorAll<HTMLElement>("[data-apply-courses] li")) {
      const id = li.dataset.courseId as CourseId;
      expect(text(li)).toContain(`${COURSE_TITLES[id]} (${courseLength(COURSE_MINUTES[id])}):`);
    }
  });
});
