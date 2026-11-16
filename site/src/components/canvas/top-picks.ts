// Top picks for Startup Resources: up to 3 resources per stage, 12 in all,
// so the page can open on a short list instead of all 501 (plan step L1a;
// L1b renders it). Pure: no DOM, no network, no clock, no randomness.
//
// The ranking reads only a card's stage, substage, type, city, name and id.
// No field for money, sponsorship or self-description enters it, so nothing
// paid, sponsored or self-promotional can move a resource up (voice.md:
// founders first, never a vendor directory).
//
// Commercial cards (isCommercial below: a COMMERCIAL type, or any record in
// the service-providers substage) are firms that sell to founders. A
// featured pick reads as an endorsement, so they never appear in a first-need
// list, and a stage shows one at most, only to fill a slot that its
// non-commercial cards cannot.
//
// How one stage is picked, slot by slot:
//   1. Rank its cards: in the visitor's region (when one is given), then
//      statewide reach, then the stage's first-need type order below, then
//      name, then id.
//   2. Choose the pool. While any non-commercial card is left, the pool is
//      the non-commercial cards only. When none is left, the pool is the
//      commercial cards, until the stage holds one; after that it is empty
//      and the stage stops short.
//   3. Take the best-ranked card in the pool that adds a new type and a new
//      city. Relax the rule step by step when no card fits: new type and a
//      new city that no earlier stage used either, new type and a new city in
//      this stage, new type, new city, then anything. "statewide" and
//      "online" are not places, so they never use up a city.
import { STAGES, type Region, type ResourceCard, type Stage } from "@cs/shared";

import { cityKey, NOT_CITIES } from "../../lib/regions/match";

/** Picks shown per stage. */
export const PICKS_PER_STAGE = 3;

type ResourceType = ResourceCard["type"];

/**
 * Types that sell a service, capital or space to founders. A stage shows one
 * at most between them, and only once no non-commercial card is left.
 */
export const COMMERCIAL: ReadonlySet<ResourceType> = new Set(["service-provider", "investor", "coworking"]);

/**
 * The substage of firms that sell to founders. Its records count as
 * commercial whatever their type: a scoring company typed "accelerator" or an
 * investor platform typed "event" still sells to founders (PR #89 review).
 */
export const COMMERCIAL_SUBSTAGE = "service-providers";

/** True for a card that sells a service, capital or space to founders. */
export function isCommercial(card: Pick<ResourceCard, "type" | "substage">): boolean {
  return COMMERCIAL.has(card.type) || card.substage === COMMERCIAL_SUBSTAGE;
}

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

    const nonCommercial = ranked.filter((c) => !isCommercial(c));
    const commercialCards = ranked.filter(isCommercial);
    let commercial = 0;
    while (picks.length < PICKS_PER_STAGE) {
      const pool =
        nonCommercial.length > 0 ? nonCommercial : commercial < COMMERCIAL_PER_STAGE ? commercialCards : [];
      if (pool.length === 0) break;
      let index = -1;
      for (const rule of rules) {
        index = pool.findIndex(rule);
        if (index >= 0) break;
      }
      const [card] = pool.splice(index, 1);
      const reason: PickReason = inRegion(card)
        ? "your-region"
        : isStatewide(card)
          ? "statewide"
          : order.includes(card.type)
            ? "first-need"
            : "spread";
      picks.push({ card, reason });
      if (isCommercial(card)) commercial += 1;
      types.add(card.type);
      const place = placeOf(card);
      if (place !== null) cities.add(place);
    }
    for (const c of cities) usedCities.add(c);
    return { stage, picks };
  });
}
