// The events guide (lane L32). The answer points to the event calendar. The
// page then shows the calendar's next events (data/events/upcoming.json, which
// already passed the content gate) and every record Startup Resources types as
// an event, by city: startup weeks, pitch nights and hackathons, but also
// maker spaces and groups. /event-calendar/ owns the Event JSON-LD, so this
// page carries only the ItemList of those records, like every guide.

import { WAYS_IN } from "@cs/shared";
import { cityLabel } from "../../components/canvas/labels";
import { shownLocation, upcomingEvents, whenText } from "../../components/events/events";
import { NOT_CITIES } from "../regions/match";

import { asOf, dated, guide, type Guide, type GuideGroup, type GuideInput, type GuideRecord, type UpcomingList } from "./core";

/** How many of the calendar's next events the guide shows. */
export const UPCOMING_LIMIT = 12;
export const EVENT_CALENDAR = WAYS_IN.events;

/** The calendar's next events, or undefined when there are none to show. */
export function upcomingList(calendar: GuideInput["calendar"]): UpcomingList | undefined {
  if (!calendar?.snapshot) return undefined;
  const { snapshot, now } = calendar;
  // A list with no readable fetch date could not say how current it is.
  if (Number.isNaN(Date.parse(snapshot.fetchedAt))) return undefined;
  const events = upcomingEvents(snapshot, now).slice(0, UPCOMING_LIMIT);
  if (events.length === 0) return undefined;
  // Two dates: the build drops events that ended before it ran, so the list is
  // current as of the build, while its events come from the calendar as read.
  const one = events.length === 1;
  return {
    id: "upcoming",
    heading: "Coming up on the calendar",
    intro: [
      one ? "The next event" : `The next ${events.length} events`,
      " on the Colorado Startups event calendar as of ",
      dated(asOf(now)),
      `, when this page was built. ${one ? "It comes" : "They come"} from the calendar as read on `,
      dated(asOf(new Date(snapshot.fetchedAt))),
      ". Hosts run their own events, so check the event page before you go. ",
      { text: "See every event on the calendar", href: EVENT_CALENDAR },
      ".",
    ],
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      url: e.url,
      datetime: e.start,
      ...whenText(e),
      where: shownLocation(e),
    })),
  };
}

/** Records by city, A to Z, then statewide and online. */
export function byCity(items: readonly GuideRecord[]): GuideGroup[] {
  const cities = [...new Set(items.map((r) => r.city).filter((c) => !NOT_CITIES.has(c)))].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  return [...cities, "statewide", "online"]
    .map((city) => ({ heading: cityLabel(city), items: items.filter((r) => r.city === city) }))
    .filter((g) => g.items.length > 0);
}

// "Startup events in Colorado": the calendar's next events, then event records by city.
export function startupEvents({ records, date, calendar }: GuideInput): Guide {
  const series = records.filter((r) => r.type === "event");
  const upcoming = upcomingList(calendar);
  return guide(
    "colorado-startup-events",
    [
      "Find startup events in Colorado on the ",
      { text: "Colorado Startups event calendar", href: EVENT_CALENDAR },
      ", which holds Colorado Startups events and events from across the community. ",
      series.length === 1
        ? "Below is the 1 event or group that Startup Resources lists as an event, as of "
        : `Below, by city, are the ${series.length} events, groups and maker spaces that Startup Resources lists as events, as of `,
      dated(date),
      ".",
      upcoming ? " The calendar's next events come first, with times in Mountain Time." : "",
    ],
    [
      {
        id: "by-city",
        heading: "Events and groups by city",
        intro: [
          "Startup weeks, pitch nights, demo days, hackathons, maker spaces and angel groups, A to Z within each city. ",
          "Check each one's site for its next date or how to join.",
        ],
        groups: byCity(series),
      },
    ],
    upcoming,
  );
}
