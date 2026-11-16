// What each hotspot on a region painting opens (step W3b). Pure shaping, no
// Astro imports, so it unit-tests in plain Node (test/unit/l8/hotspot-cards.test.ts).
// Art.astro gathers the inputs from the helpers the region page already uses:
// buildBoard and honoreesIn for the Leaderboard, upcomingEvents and eventCity
// for the calendar, activeCards and inRegion for Startup Resources, and
// organizerFor for the seat. RegionArt.astro draws the cards as popovers and
// the same links as a plain list under the painting. Owner: L8.
import type { Company, Hotspot, Region, ResourceCard } from "@cs/shared";

import type { CalendarEvent } from "../events/events";

/** Companies a card shows at most. */
export const CARD_COMPANIES = 5;
/** Startup Resources a card shows. */
export const CARD_RESOURCES = 3;

export interface CardLink {
  text: string;
  /** Absent when the source has no page to link, such as an event with no URL. */
  href?: string;
  /** A short plain line under the link: a city, a date. */
  meta?: string;
}

export interface HotspotCard {
  /** The hotspot's own label, so the card and its button share one name. */
  label: string;
  kind: Hotspot["kind"];
  x: number;
  y: number;
  /** The id the button's popovertarget names. */
  id: string;
  links: CardLink[];
  /** Said plainly when there is nothing to list. */
  empty?: string;
  /** The link on to the full list. Every card has one. */
  more: { text: string; href: string };
}

export interface CardInputs {
  region: Pick<Region, "id" | "name" | "hotspots">;
  /** The region's Leaderboard honorees, in the order to show them; the card takes the first CARD_COMPANIES. */
  companies: readonly Pick<Company, "id" | "name" | "website" | "hq_city">[];
  /** How many honorees the region has in all. */
  companiesTotal: number;
  /** Where "see all" goes for companies. */
  companiesHref: string;
  /** The region's next event on the calendar, if it has one. */
  event?: Pick<CalendarEvent, "title" | "url"> & { when: string };
  eventsHref: string;
  /** The region's Startup Resources, in the order to show them; the card takes the first CARD_RESOURCES. */
  resources: readonly Pick<ResourceCard, "id" | "name" | "url" | "city">[];
  /** How many Startup Resources the region has in all. */
  resourcesTotal: number;
  resourcesHref: string;
  /** The region's organizer seat. */
  seat: { title: string; open: boolean; holder?: string; href: string };
  /** Where every seat is listed. */
  seatsHref: string;
}

/** One card per hotspot, in the data file's order. A place hotspot (none yet) opens no card. */
export function hotspotCards(input: CardInputs): HotspotCard[] {
  const { region } = input;
  return (region.hotspots ?? []).flatMap((h): HotspotCard[] => {
    if (h.kind === "place") return [];
    const base = { label: h.label, kind: h.kind, x: h.x, y: h.y, id: `hotspot-${region.id}-${h.kind}` };
    switch (h.kind) {
      case "companies": {
        const shown = input.companies.slice(0, CARD_COMPANIES);
        return [
          {
            ...base,
            links: shown.map((c) => ({ text: c.name, href: c.website, meta: c.hq_city })),
            empty: shown.length === 0 ? `No Leaderboard company is headquartered in ${region.name} yet.` : undefined,
            more: {
              text: input.companiesTotal > 0 ? `See all ${input.companiesTotal} on the Leaderboard` : "See the Leaderboard",
              href: input.companiesHref,
            },
          },
        ];
      }
      case "event": {
        const e = input.event;
        return [
          {
            ...base,
            links: e ? [{ text: e.title, href: e.url ?? undefined, meta: e.when }] : [],
            empty: e ? undefined : `No ${region.name} event is on the calendar yet.`,
            more: { text: "See the event calendar", href: input.eventsHref },
          },
        ];
      }
      case "resources": {
        const shown = input.resources.slice(0, CARD_RESOURCES);
        return [
          {
            ...base,
            links: shown.map((r) => ({ text: r.name, href: r.url, meta: r.city })),
            empty: shown.length === 0 ? `No Startup Resource is listed in ${region.name} yet.` : undefined,
            more: {
              text: input.resourcesTotal > 0 ? `See all ${input.resourcesTotal} Startup Resources here` : "Browse Startup Resources",
              href: input.resourcesHref,
            },
          },
        ];
      }
      case "seat": {
        const { seat } = input;
        return [
          {
            ...base,
            links: seat.open ? [{ text: seat.title, href: seat.href, meta: "Open now, an unpaid volunteer seat" }] : [],
            empty: seat.open ? undefined : `${seat.holder ?? "A volunteer"} holds the ${seat.title} seat, so it is not open now.`,
            more: { text: "See every volunteer seat", href: input.seatsHref },
          },
        ];
      }
    }
  });
}
