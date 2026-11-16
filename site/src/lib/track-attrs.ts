// The data-track marks (step M1c, engagement plan): the attributes a control
// carries so the one click listener (track.ts) sends its event. Pages call
// trackAttrs() in their frontmatter and spread the result on the control.
//
// A name off EVENT_PROPS, a key the event does not list, or a value that is
// not a short slug throws, so a bad mark stops the build instead of shipping.
// site/test/dom/track-attrs.test.ts checks the built pages again.
//
// No zod: the scripts that send events themselves (form-status.ts, the
// Resourcus panel) load whereOf() and shortSlug() from here, so this file
// imports the event list by path, as track.ts does.

import { EVENT_PROPS, type EventName, PROP_TOKEN } from "../../../packages/shared/src/events";

type PropKey<N extends EventName> = (typeof EVENT_PROPS)[N][number];

/** The attributes that make a control send `name` with `props` when clicked. */
export function trackAttrs<N extends EventName>(name: N, props: { [K in PropKey<N>]?: string }): Record<string, string> {
  const listed: readonly string[] = EVENT_PROPS[name];
  const attrs: Record<string, string> = { "data-track": name };
  // A generic mapped type loses its value type in Object.entries, so name it.
  for (const [key, value] of Object.entries(props) as [string, string | undefined][]) {
    if (value === undefined) continue;
    if (!listed.includes(key)) throw new Error(`track-attrs: ${name} lists no prop "${key}"`);
    if (!PROP_TOKEN.test(value)) throw new Error(`track-attrs: ${name} ${key}="${value}" is not a short slug`);
    attrs[`data-track-${key}`] = value;
  }
  return attrs;
}

/** A slug cut to the 40 characters a prop may hold, at a dash, so a long resource id still fits. */
export function shortSlug(slug: string, max = 40): string {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const dash = cut.lastIndexOf("-");
  return dash > 0 ? cut.slice(0, dash) : cut;
}

/** A page path as a `where` slug: "/" is "home", "/join/slack/" is "join-slack". */
export function whereOf(path: string): string {
  const slug = path
    .toLowerCase()
    .split("/")
    .filter(Boolean)
    .join("-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return shortSlug(slug || "home");
}

/** The two ways to join that a join_click counts. */
export type JoinWay = "slack" | "linkedin-group";

/**
 * A join control's mark. join_click carries only `where`, so a LinkedIn Group
 * join adds "-linkedin" to it and stays apart from the Slack join in the same
 * band. A `where` too long for the suffix throws, as any bad value does.
 */
export function joinAttrs(where: string, way: JoinWay = "slack"): Record<string, string> {
  return trackAttrs("join_click", { where: way === "slack" ? where : `${where}-linkedin` });
}

// Hosts with a known name. Any other host goes by its own name (eventSource).
const EVENT_HOSTS: Record<string, string> = {
  "lu.ma": "luma",
  "luma.com": "luma",
  "meetup.com": "meetup",
  "eventbrite.com": "eventbrite",
  "bit.ly": "bitly",
};

/**
 * Where an event's own link goes, as event_out's `source`: luma, meetup or
 * eventbrite, or another host by its name less the top-level part
 * (letsvibe.org is "letsvibe"). Never the URL itself.
 */
export function eventSource(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "other";
  }
  const known = EVENT_HOSTS[host];
  if (known) return known;
  const name = shortSlug(
    host
      .split(".")
      .slice(0, -1)
      .join("-")
      .replace(/[^a-z0-9-]/g, ""),
  );
  return name && PROP_TOKEN.test(name) ? name : "other";
}
