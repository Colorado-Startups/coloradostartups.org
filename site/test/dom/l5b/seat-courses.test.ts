import { COURSE_TITLES, courseUrl, type CourseId } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { COURSE_MINUTES, courseLength } from "../../../src/components/positions/courses";
import { readDist } from "../pages";

// L5b (#146): a seat card that takes applications lists its Claude Academy
// courses above the apply button, linked and timed, and says who Paul is.
// Built HTML from dist/.

const doc = (rel: string) => new DOMParser().parseFromString(readDist(rel), "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("/get-involved/ seat cards that take applications", () => {
  const cards = [...doc("get-involved/index.html").querySelectorAll("main [data-position]")].filter((c) =>
    c.querySelector("a[data-apply]"),
  );

  it("exist", () => {
    expect(cards.length).toBeGreaterThan(0);
  });

  it("list each course with its Claude Academy link and length, before the apply button", () => {
    for (const card of cards) {
      const list = card.querySelector("[data-seat-courses]")!;
      expect(text(list.querySelector("h4"))).toBe("Take these courses first");
      const items = [...list.querySelectorAll<HTMLElement>("li[data-course-id]")];
      expect(items.length, card.getAttribute("data-position")!).toBeGreaterThan(0);
      for (const li of items) {
        const id = li.dataset.courseId as CourseId;
        expect(li.querySelector("a")?.getAttribute("href")).toBe(courseUrl(id));
        expect(text(li)).toBe(`${COURSE_TITLES[id]}, ${courseLength(COURSE_MINUTES[id])}`);
      }
      const apply = card.querySelector("a[data-apply]")!;
      expect(list.compareDocumentPosition(apply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
