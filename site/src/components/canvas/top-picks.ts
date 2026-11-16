// Top picks for Startup Resources: up to 3 resources per stage, 12 in all,
// so the page can open on a short list instead of all 501 (plan step L1a;
// L1b renders it). Pure: no DOM, no network, no clock, no randomness.
//
// The ranking reads only a card's stage, type, city, name and id. No field
// for money, sponsorship or self-description enters it, so nothing paid,
// sponsored or self-promotional can move a resource up (voice.md: founders
// first, never a vendor directory).
//
// Commercial types (COMMERCIAL below) are firms that sell to founders. A
// featured pick reads as an endorsement, so they never appear in a first-need
// list, get at most one pick a stage between them, and rank after every
// non-commercial card.
//
// How one stage is picked, slot by slot:
//   1. Rank its cards: non-commercial first, then in the visitor's region
//      (when one is given), then statewide reach, then the stage's
//      first-need type order below, then name, then id.
//   2. Skip commercial cards once the stage holds one. The commercial pick
//      always shows after the non-commercial ones.
//   3. Take the best-ranked card that adds a new type and a new city. Relax
//      the rule step by step when no card fits: new type and a new city that
//      no earlier stage used either, new type and a new city in this stage,
//      new type, new city, then anything. "statewide" and "online" are not
//      places, so they never use up a city.
import { STAGES, type Region, type ResourceCard, type Stage } from "@cs/shared";

import { cityKey, NOT_CITIES } from "../../lib/regions/match";

/** Picks shown per stage. */
export const PICKS_PER_STAGE = 3;

type ResourceType = ResourceCard["type"];

/**
 * Types that sell a service, capital or space to founders. At most one pick
 * a stage between them, ranked last.
 */
export const COMMERCIAL: ReadonlySet<ResourceType> = new Set(["service-provider", "investor", "coworking"]);

/** At most this many commercial picks in one stage. */
export const COMMERCIAL_PER_STAGE = 1;

/**
 * The non-commercial resource types a founder needs first at each stage,
 * most needed first. Types left out rank after these, in schema order.
 */
export const FIRST_NEED: Record<Stage, readonly ResourceType[]> = {
  idea: [
    "education", // learn the basics before spending money or time
    "community", // find peers, mentors and a co-founder
    "event", // meet people in person and test the idea out loud
    "media", // read how other Colorado founders started
  ],
  launch: [
    "accelerator", // a structured program with mentors, often with first capital
    "incubator", // early support and space for a company not ready for a cohort
    "education", // how to form, fund and run the company
    "event", // meet first customers, hires and investors
    "community", // founders a step ahead who have done it
  ],
  growth: [
    "accelerator", // growth-stage programs with mentors and a network
    "media", // reach customers and recruits
    "community", // peers who have scaled
    "event", // meet partners and later-stage backers
  ],
  support: [
    "government", // state and city programs, grants and the SBDC network
    "university", // research, talent and tech transfer
    "nonprofit", // mission-driven help at no cost
    "community", // peers who help at every stage
  ],
};

/** Why a card was picked, for the UI to turn into a plain label. */
export type PickReason = "your-region" | "statewide" | "first-need" | "spread";

export interface TopPick {
  card: ResourceCard;
  reason: PickReason;
}

export interface StagePicks {
  stage: Stage;
  picks: TopPick[];
}

export interface TopPicksOptions {
  /** The visitor's region; its `cities` and `nearby` lists count as in it. */
  region?: Pick<Region, "cities" | "nearby">;
}

const byName = (a: ResourceCard, b: ResourceCard) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The city a card uses up for spread, or null for "statewide" and "online". */
function placeOf(card: ResourceCard): string | null {
  const key = cityKey(card.city);
  return key === "" || NOT_CITIES.has(key) ? null : key;
}

const isStatewide = (card: ResourceCard) => cityKey(card.city) === "statewide";

/**
 * Up to 3 picks for each of the four stages, in journey order. The same
 * input always gives the same output, whatever order the cards arrive in.
 */
export function topPicks(cards: readonly ResourceCard[], options: TopPicksOptions = {}): StagePicks[] {
  const regionCities = options.region
    ? new Set([...options.region.cities, ...options.region.nearby].map(cityKey))
    : null;
  const inRegion = (card: ResourceCard) => {
    const place = placeOf(card);
    return regionCities !== null && place !== null && regionCities.has(place);
  };
  const usedCities = new Set<string>();

  return STAGES.map((stage) => {
    const order = FIRST_NEED[stage];
    const typeRank = (t: ResourceType) => {
      const i = order.indexOf(t);
      return i < 0 ? order.length : i;
    };
    const ranked = cards
      .filter((c) => c.stage === stage)
      .sort(
        (a, b) =>
          Number(COMMERCIAL.has(a.type)) - Number(COMMERCIAL.has(b.type)) ||
          Number(inRegion(b)) - Number(inRegion(a)) ||
          Number(isStatewide(b)) - Number(isStatewide(a)) ||
          typeRank(a.type) - typeRank(b.type) ||
          byName(a, b),
      );

    const picks: TopPick[] = [];
    const types = new Set<ResourceType>();
    const cities = new Set<string>();
    const newType = (c: ResourceCard) => !types.has(c.type);
    const newCity = (c: ResourceCard) => {
      const p = placeOf(c);
      return p === null || !cities.has(p);
    };
    // A city no earlier stage used. A region has only a few cities, so its
    // own cards are exempt: the region bias outranks spread across stages.
    const unusedCity = (c: ResourceCard) => {
      const p = placeOf(c);
      return p === null || inRegion(c) || !usedCities.has(p);
    };
    const rules: ((c: ResourceCard) => boolean)[] = [
      (c) => newType(c) && newCity(c) && unusedCity(c),
      (c) => newType(c) && newCity(c),
      newType,
      newCity,
      () => true,
    ];

    const left = [...ranked];
    let commercial = 0;
    while (picks.length < PICKS_PER_STAGE) {
      if (commercial >= COMMERCIAL_PER_STAGE) {
        for (let i = left.length - 1; i >= 0; i--) if (COMMERCIAL.has(left[i].type)) left.splice(i, 1);
      }
      if (left.length === 0) break;
      let index = -1;
      for (const rule of rules) {
        index = left.findIndex(rule);
        if (index >= 0) break;
      }
      const [card] = left.splice(index, 1);
      const reason: PickReason = inRegion(card)
        ? "your-region"
        : isStatewide(card)
          ? "statewide"
          : order.includes(card.type)
            ? "first-need"
            : "spread";
      picks.push({ card, reason });
      if (COMMERCIAL.has(card.type)) commercial += 1;
      types.add(card.type);
      const place = placeOf(card);
      if (place !== null) cities.add(place);
    }
    for (const c of cities) usedCities.add(c);
    // Spread can take the commercial card before a non-commercial one; it
    // still shows last.
    const shown = [...picks.filter((p) => !COMMERCIAL.has(p.card.type)), ...picks.filter((p) => COMMERCIAL.has(p.card.type))];
    return { stage, picks: shown };
  });
}
