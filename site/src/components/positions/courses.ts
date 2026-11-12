// Each Claude Academy course's length, as the course's own page lists it
// (academy.claude.com/courses/<id>, read 2026-11-04: 2.5 hr, 4 hr, 45 min,
// 3.5 hr). Kept in minutes so a seat's total adds up exactly. When Claude
// Academy changes a course, change it here.
import type { CourseId } from "@cs/shared";

export const COURSE_MINUTES: Readonly<Record<CourseId, number>> = {
  "claude-101": 150,
  "ai-fluency-framework-foundations": 240,
  "building-effective-human-agent-teams": 45,
  "ai-fluency-for-small-businesses": 210,
};

/** One course's length: "45 minutes", "2.5 hours", "4 hours". */
export function courseLength(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
}

/** A seat's courses together, to the nearest hour: "about 10 hours". */
export function totalLength(ids: readonly CourseId[]): string {
  const hours = Math.round(ids.reduce((n, id) => n + COURSE_MINUTES[id], 0) / 60);
  return `about ${hours} ${hours === 1 ? "hour" : "hours"}`;
}
