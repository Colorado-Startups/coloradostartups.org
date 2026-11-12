// Every outside address the info pages use, in one place, so the pages, the
// tests and llms.txt agree. Owner: L13.

/** The community inbox (decision 32 names it for privacy requests too). */
export const CONTACT_EMAIL = "info@coloradostartups.org";

/** The mailing address, as the site footer prints it. */
export const POSTAL_ADDRESS = ["Colorado Startups, Ltd.", "951 20th Street, Unit 2194", "Denver, CO 80201"] as const;

// The public Google Calendar behind the old /event-calendar page. Its id was
// read from the live Squarespace page's embed on 2026-10-18.
export const CALENDAR_ID = "c_9ae087f89282cf071479ae85476c1f22a42706b2cb05d9d3eb99204a41a5aaed@group.calendar.google.com";
export const CALENDAR_TIMEZONE = "America/Denver";

/**
 * The embed URL. Agenda mode leads with what is coming up and stays readable
 * at phone width; the tabs let a visitor switch to the month grid. The host
 * must stay calendar.google.com, the one frame-src the CSP allows for it.
 */
export function calendarEmbedUrl(id: string = CALENDAR_ID): string {
  const url = new URL("https://calendar.google.com/calendar/embed");
  url.searchParams.set("src", id);
  url.searchParams.set("ctz", CALENDAR_TIMEZONE);
  url.searchParams.set("mode", "AGENDA");
  url.searchParams.set("showTitle", "0");
  url.searchParams.set("showPrint", "0");
  url.searchParams.set("showCalendars", "0");
  return url.toString();
}

/** Opens Google Calendar and offers to add this calendar to the visitor's own. */
export function calendarSubscribeUrl(id: string = CALENDAR_ID): string {
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("cid", id);
  return url.toString();
}

/** Where Colorado Startups posts the events it hosts (the old page's Luma link, now on luma.com). */
export const LUMA_CS = "https://luma.com/coloradostartups";

/** Startup Hikes and Startup Ski Days live here now (the Oct 6 dispatch). */
export const LUMA_SCP = "https://luma.com/startup-community-project";

export const GOOGLE_PRIVACY = "https://policies.google.com/privacy";

/** A mailto link with a subject line, for the event submission ask. */
export function mailto(subject?: string): string {
  return subject ? `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}` : `mailto:${CONTACT_EMAIL}`;
}
