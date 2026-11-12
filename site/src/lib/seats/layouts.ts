// The four seat pages' layouts (lane L38), ported from the volunteer kit's
// final pages/<seat id>.html. The kit owner marked all four final on
// 2026-10-18. Words that come from roles.json (titles, one-liners, perks,
// steps, what you bring, what Paul looks for, ground rules) live in
// data/positions/ and are never repeated here. layouts/<seat>.ts holds only
// each page's own headings, captions and tiles, and which facts each figure shows.
//
// Every page answers the kit README's five questions in this order: what you
// get, how it grows your network, how it helps Colorado, who we are looking
// for, how to apply. SeatLayout keys the sections by question, and SECTION_ORDER
// fixes the order, so a page cannot skip or swap one.
import { SECTION_ORDER, type Block, type SeatLayout, type SectionKey } from "./layout-types";
import { FUSION_CANYON_CONNECTOR } from "./layouts/fusion-canyon-connector";
import { PHOTON_MOUNTAIN_CONNECTOR } from "./layouts/photon-mountain-connector";
import { SLACK_COMMUNITY_LEAD } from "./layouts/slack-community-lead";
import { SPACE_PEAK_CONNECTOR } from "./layouts/space-peak-connector";
import { COURSES_REF } from "./sources";
import type { NetworkSeat } from "./viz";

export { SECTION_ORDER, type Block, type SeatLayout, type SectionKey } from "./layout-types";

/** The kicker over each section's heading: the question it answers (kit README, "The job of every page"). */
export const SECTION_KICKERS: Readonly<Record<SectionKey, string>> = {
  get: "What you get",
  network: "How it grows your network",
  colorado: "How it helps Colorado",
  who: "Who we are looking for",
  apply: "How to apply",
};

/** The anchor the hero button and the site's links jump to: the apply section, which opens with the steps. */
export const HOW_TO_APPLY = "how-to-apply";

// One layout per seat page, in the kit's order; each lives in layouts/<seat>.ts.
export const SEAT_LAYOUTS: Readonly<Record<NetworkSeat, SeatLayout>> = {
  "slack-community-lead": SLACK_COMMUNITY_LEAD,
  "photon-mountain-connector": PHOTON_MOUNTAIN_CONNECTOR,
  "fusion-canyon-connector": FUSION_CANYON_CONNECTOR,
  "space-peak-connector": SPACE_PEAK_CONNECTOR,
};

/** True for a seat id that has a layout here. */
export function hasLayout(id: string): id is NetworkSeat {
  return Object.hasOwn(SEAT_LAYOUTS, id);
}

/** Every source ref a layout cites, in page order: fact ids, and COURSES_REF where the course table sits. */
export function layoutRefs(layout: SeatLayout): string[] {
  const refs: string[] = [];
  const walk = (blocks: readonly Block[]) => {
    for (const block of blocks) {
      if (block.kind === "bars" || block.kind === "stats") refs.push(...block.facts);
      else if (block.kind === "courses") refs.push(COURSES_REF);
      else if (block.kind === "split") {
        walk(block.left);
        walk(block.right);
      }
    }
  };
  for (const key of SECTION_ORDER) walk(layout.sections[key].blocks);
  return refs;
}
