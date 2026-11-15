// The four seat pages' layouts (lane L38). They began as ports of the
// volunteer kit's final pages/<seat id>.html (marked final 2026-10-18); on
// 2026-11-15 Paul asked for visual first and few words, so each page now
// answers three questions: what you do, why it matters, how to apply. Words
// that come from roles.json (titles, one-liners, perks, steps, what you
// bring) live in data/positions/ and are never repeated here.
// layouts/<seat>.ts holds only each page's own headings, captions and tiles,
// and which facts each figure shows. SeatLayout keys the sections by
// question, and SECTION_ORDER fixes the order.
import { SECTION_ORDER, type Block, type SeatLayout, type SectionKey } from "./layout-types";
import { FUSION_CANYON_CONNECTOR } from "./layouts/fusion-canyon-connector";
import { PHOTON_MOUNTAIN_CONNECTOR } from "./layouts/photon-mountain-connector";
import { SLACK_COMMUNITY_LEAD } from "./layouts/slack-community-lead";
import { SPACE_PEAK_CONNECTOR } from "./layouts/space-peak-connector";
import { COURSES_REF } from "./sources";
import type { NetworkSeat } from "./viz";

export { SECTION_ORDER, type Block, type SeatLayout, type SectionKey } from "./layout-types";

/** The kicker over each section's heading: the question it answers. */
export const SECTION_KICKERS: Readonly<Record<SectionKey, string>> = {
  what: "What you do",
  why: "Why it matters",
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
