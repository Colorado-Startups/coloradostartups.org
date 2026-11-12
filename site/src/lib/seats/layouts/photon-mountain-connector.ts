// The photon mountain connector seat page's layout (layouts.ts holds all four).
import { REGION_ART_ALT } from "../../../components/art/keepers";
import { APPLICATIONS, APPLY_HEADING, WEAK_TIES, type SeatLayout } from "../layout-types";

export const PHOTON_MOUNTAIN_CONNECTOR: SeatLayout = {
  hero: {
    art: "regions/photon-mountain",
    alt: REGION_ART_ALT["photon-mountain"],
    kicker: "Photon Mountain outpost",
    pills: ["Boulder", "Denver", "Golden"],
    cta: "See how to apply",
  },
  sections: {
    get: {
      heading: "Built into your career",
      blocks: [{ kind: "perks" }, { kind: "stats", facts: ["deloitte-hiring", "deloitte-skills", "cncs-job-odds"] }],
    },
    network: {
      heading: "Every intro runs through you",
      blocks: [
        {
          kind: "split",
          left: [
            {
              kind: "network",
              seat: "photon-mountain-connector",
              caption: "You at the center, linking founders in each city to the people they need across Photon Mountain.",
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
        {
          kind: "split",
          left: [
            { kind: "bars", facts: WEAK_TIES, caption: "Most who found work through a contact saw that contact only now and then." },
          ],
          right: [{ kind: "stats", facts: ["weak-ties-linkedin", "slack-weekly-threads"] }],
        },
      ],
    },
    colorado: {
      heading: "Forge one Photon Mountain",
      blocks: [
        {
          kind: "split",
          left: [{ kind: "map", region: "photon-mountain", caption: "The Photon Mountain triangle, from the Flatirons to downtown Denver." }],
          right: [
            {
              kind: "bars",
              facts: ["dist-boulder-denver", "dist-boulder-golden", "dist-denver-golden"],
              caption: "Straight-line distances between the cities.",
            },
          ],
        },
        {
          kind: "split",
          left: [{ kind: "plaque", lines: ["A Golden founder meets the Boulder engineer they need. That is the heart of the role."] }],
          right: [{ kind: "bars", facts: APPLICATIONS, caption: "Each new business needs people to meet. You make the intros." }],
        },
      ],
    },
    who: {
      heading: "Connectors at heart",
      blocks: [
        { kind: "bring", heading: "What you bring" },
        { kind: "lookFor", heading: "In the interview, Paul looks for" },
        { kind: "rules", heading: "Ground rules" },
      ],
    },
    apply: {
      heading: "Open the bronze doors",
      blocks: [{ kind: "steps" }, { kind: "courses" }, { kind: "apply", heading: APPLY_HEADING }],
    },
  },
};
