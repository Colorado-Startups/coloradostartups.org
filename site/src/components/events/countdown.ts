// The relative countdown on home's This week strip (ThisWeek.astro): "today",
// "tomorrow", "in 2 days". The build writes it once, and the strip's script
// writes it again on the visitor's clock, so a page built days ago still
// counts from today. Days are calendar days in Mountain Time, the calendar's
// zone. Plain functions, no DOM, so the build and the browser share them.
import { CALENDAR_TIMEZONE } from "../info/links";

const dayKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: CALENDAR_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** Whole calendar days in Mountain Time from `now` to `start`. */
export function daysUntil(start: number, now: number): number {
  const day = (t: number) => Date.parse(`${dayKey.format(t)}T00:00:00Z`);
  return Math.round((day(start) - day(now)) / 86_400_000);
}

/** "on now" once it has started, else "today", "tomorrow" or "in N days". */
export function countdown(start: number, now: number): string {
  if (start <= now) return "on now";
  return relative.format(daysUntil(start, now), "day");
}
