// The space peak connector seat page's layout (layouts.ts holds all four).
import { REGION_ART_ALT } from "../../../components/art/keepers";
import { APPLY_HEADING, type SeatLayout } from "../layout-types";

export const SPACE_PEAK_CONNECTOR: SeatLayout = {
  hero: {
    art: "brand/springs",
    alt: REGION_ART_ALT["space-peak"],
    kicker: "Space Peak",
    pills: ["Colorado Springs", "Monument", "Fountain", "Woodland Park"],
    cta: "See how to apply",
  },
  sections: {
    what: {
      heading: "Know everyone under the peak",
      blocks: [
        {
          kind: "split",
          left: [
            {
              kind: "network",
              seat: "space-peak-connector",
              caption: "You link Space Peak founders to Photon Mountain and Fusion Canyon.",
            },
          ],
          right: [
            {
              kind: "tiles",
              tiles: [
                { icon: "calendar", label: "Go to startup events" },
                { icon: "handshake", label: "Greet and introduce" },
                { icon: "link", label: "Bridge the regions" },
                { icon: "coffee", label: "Coffee with helpers" },
                { icon: "chat", label: "Invite people in" },
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
          left: [
            {
              kind: "map",
              region: "space-peak",
              caption: "Space Peak, from Monument to Fountain and up Ute Pass to Woodland Park.",
            },
          ],
          right: [{ kind: "bars", facts: ["deloitte-hiring", "deloitte-skills"], caption: "Why volunteer work counts." }],
        },
      ],
    },
    apply: {
      heading: "Step through the doors",
      blocks: [{ kind: "steps" }, { kind: "courses" }, { kind: "apply", heading: APPLY_HEADING }],
    },
  },
};
