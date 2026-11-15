// The fusion canyon connector seat page's layout (layouts.ts holds all four).
import { REGION_ART_ALT } from "../../../components/art/keepers";
import { APPLY_HEADING, WEAK_TIES, type SeatLayout } from "../layout-types";

export const FUSION_CANYON_CONNECTOR: SeatLayout = {
  hero: {
    art: "brand/fortcollins",
    alt: REGION_ART_ALT["fusion-canyon"],
    kicker: "Fusion Canyon",
    pills: ["Fort Collins", "Loveland", "Windsor", "Greeley"],
    cta: "See how to apply",
  },
  sections: {
    what: {
      heading: "The first friendly face",
      blocks: [
        {
          kind: "split",
          left: [
            {
              kind: "network",
              seat: "fusion-canyon-connector",
              caption: "You link Northern Colorado founders to Photon Mountain and Space Peak.",
            },
          ],
          right: [
            {
              kind: "tiles",
              tiles: [
                { icon: "calendar", label: "Show up at startup events" },
                { icon: "door", label: "Greet the newcomer first" },
                { icon: "link", label: "Link the regions" },
                { icon: "coffee", label: "Coffee with helpers" },
                { icon: "chat", label: "Invite people to the Slack" },
                { icon: "star", label: "Share local wins" },
              ],
            },
          ],
        },
        { kind: "bring", heading: "What you bring" },
      ],
    },
    why: {
      heading: "What you carry home",
      blocks: [
        { kind: "perks" },
        {
          kind: "split",
          left: [{ kind: "map", region: "fusion-canyon", caption: "Fusion Canyon: Fort Collins, Loveland, Windsor and Greeley." }],
          right: [{ kind: "bars", facts: WEAK_TIES, caption: "How often people saw the contact who led them to new work." }],
        },
      ],
    },
    apply: {
      heading: "Your way in",
      blocks: [{ kind: "steps" }, { kind: "courses" }, { kind: "apply", heading: APPLY_HEADING }],
    },
  },
};
