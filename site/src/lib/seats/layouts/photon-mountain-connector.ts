// The photon mountain connector seat page's layout (layouts.ts holds all four).
import { REGION_ART_ALT } from "../../../components/art/keepers";
import { APPLICATIONS, APPLY_HEADING, type SeatLayout } from "../layout-types";

export const PHOTON_MOUNTAIN_CONNECTOR: SeatLayout = {
  hero: {
    art: "brand/boulder",
    alt: REGION_ART_ALT["photon-mountain"],
    kicker: "Photon Mountain",
    pills: ["Boulder", "Denver", "Golden"],
    cta: "See how to apply",
  },
  sections: {
    what: {
      heading: "Every intro runs through you",
      blocks: [
        {
          kind: "split",
          left: [
            {
              kind: "network",
              seat: "photon-mountain-connector",
              caption: "You at the center, linking founders to the people they need.",
            },
          ],
          right: [
            {
              kind: "tiles",
              tiles: [
                { icon: "calendar", label: "Show up at startup events" },
                { icon: "handshake", label: "Introduce founders to helpers" },
                { icon: "link", label: "Link Boulder, Denver and Golden" },
                { icon: "coffee", label: "Coffee with new helpers" },
                { icon: "chat", label: "Invite people to the Slack" },
                { icon: "clock", label: "Follow up on every intro" },
              ],
            },
          ],
        },
        { kind: "bring", heading: "What you bring" },
      ],
    },
    why: {
      heading: "Built into your career",
      blocks: [
        { kind: "perks" },
        {
          kind: "split",
          left: [{ kind: "map", region: "photon-mountain", caption: "The Photon Mountain triangle, from the Flatirons to downtown Denver." }],
          right: [{ kind: "bars", facts: APPLICATIONS, caption: "Each new business needs people to meet. You make the intros." }],
        },
      ],
    },
    apply: {
      heading: "Open the bronze doors",
      blocks: [{ kind: "steps" }, { kind: "courses" }, { kind: "apply", heading: APPLY_HEADING }],
    },
  },
};
