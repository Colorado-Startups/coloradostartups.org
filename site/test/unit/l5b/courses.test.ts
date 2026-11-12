import { COURSE_IDS, REQUIRED_COURSES } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { COURSE_MINUTES, courseLength, totalLength } from "../../../src/components/positions/courses";

// L5b (#146): Claude Academy course lengths, as each course's page lists them
// (read 2026-11-04).

describe("course lengths", () => {
  it("has a length for every course a seat can need", () => {
    for (const id of COURSE_IDS) expect(COURSE_MINUTES[id], id).toBeGreaterThan(0);
  });

  it("reads as Claude Academy writes it", () => {
    expect(courseLength(COURSE_MINUTES["claude-101"])).toBe("2.5 hours");
    expect(courseLength(COURSE_MINUTES["ai-fluency-framework-foundations"])).toBe("4 hours");
    expect(courseLength(COURSE_MINUTES["building-effective-human-agent-teams"])).toBe("45 minutes");
    expect(courseLength(COURSE_MINUTES["ai-fluency-for-small-businesses"])).toBe("3.5 hours");
  });

  it("totals a seat's courses to the nearest hour", () => {
    expect(totalLength(REQUIRED_COURSES["slack-community-lead"])).toBe("about 7 hours");
    expect(totalLength(REQUIRED_COURSES["photon-mountain-connector"])).toBe("about 10 hours");
    expect(totalLength(["building-effective-human-agent-teams"])).toBe("about 1 hour");
  });
});
