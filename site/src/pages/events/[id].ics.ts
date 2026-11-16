// GET /events/<id>.ics: one upcoming event as a calendar file, for the "Add
// to calendar" link on each row of /event-calendar/'s list (step L2b).
// Prerendered into dist/ at build, one file per event the list shows, like
// the /data/ files; nothing is written to the source tree. The ids come from
// eventSlug (components/events/ics.ts), since the snapshot's own ids are not
// URL-safe. Endpoints stay out of the sitemap (test/dom/events-ics.test.ts).
import type { GetStaticPaths } from "astro";

import { type CalendarEvent, SNAPSHOT, upcomingEvents } from "../../components/events/events";
import { eventIcs, eventSlug } from "../../components/events/ics";

export const prerender = true;

export const getStaticPaths = (() =>
  upcomingEvents(SNAPSHOT, new Date()).map((event) => ({
    params: { id: eventSlug(event) },
    props: { event },
  }))) satisfies GetStaticPaths;

export function GET({ props }: { props: { event: CalendarEvent } }) {
  return new Response(eventIcs(props.event, { stamp: SNAPSHOT?.fetchedAt ?? props.event.start }), {
    headers: { "Content-Type": "text/calendar; charset=utf-8" },
  });
}
