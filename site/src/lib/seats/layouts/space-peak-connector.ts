// The space peak connector seat page's layout (layouts.ts holds all four).
import { REGION_ART_ALT } from "../../../components/art/keepers";
import { APPLY_HEADING, WEAK_TIES, type SeatLayout } from "../layout-types";

export const SPACE_PEAK_CONNECTOR: SeatLayout = {
  hero: {
    art: "regions/space-peak",
    alt: REGION_ART_ALT["space-peak"],
    kicker: "Volunteer role · Space Peak",
    pills: ["Colorado Springs", "Manitou Springs", "Monument", "Fountain", "Woodland Park", "Cascade"],
    cta: "See how to apply",
  },
  sections: {
    get: {
      heading: "What you carry home",
      blocks: [
        { kind: "perks" },
        {
          kind: "split",
          left: [{ kind: "bars", facts: ["deloitte-hiring", "deloitte-resume", "deloitte-skills"], caption: "Why volunteer work counts." }],
          right: [{ kind: "stats", facts: ["cncs-job-odds"] }],
        },
      ],
    },
    network: {
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
              caption: "The work is the network.",
              tiles: [
                { icon: "calendar", label: "Go to startup events", note: "As many as you can, across the region" },
                { icon: "handshake", label: "Greet and introduce", note: "Newcomers first" },
                { icon: "link", label: "Bridge the outposts", note: "Photon Mountain and Fusion Canyon" },
                { icon: "coffee", label: "Coffee with helpers", note: "Match each one to a project" },
                { icon: "chat", label: "Invite people in", note: "Slack, Startupers, the next event" },
                { icon: "star", label: "Share local wins", note: "With the whole community" },
              ],
            },
          ],
        },
        {
          kind: "split",
          left: [{ kind: "bars", facts: WEAK_TIES, caption: "How often people saw the contact who led them to new work." }],
          right: [{ kind: "stats", facts: ["weak-ties-linkedin"] }],
        },
      ],
    },
    colorado: {
      heading: "Bring the Springs into the Hall",
      blocks: [
        {
          kind: "split",
          left: [
            {
              kind: "map",
              region: "space-peak",
              caption: "Space Peak reaches from Monument in the north to Fountain in the south, and up Ute Pass to Woodland Park.",
            },
          ],
          right: [
            {
              kind: "bars",
              facts: [
                "dist-colorado-springs-denver",
                "dist-colorado-springs-golden",
                "dist-colorado-springs-boulder",
                "dist-colorado-springs-fort-collins",
              ],
              caption: "From Colorado Springs to cities in the other outposts.",
            },
          ],
        },
        { kind: "stats", facts: ["space-peak-metro-pop", "el-paso-county-rank", "outpost-population-share"] },
        {
          kind: "plaque",
          lines: ["Founders under Pikes Peak should know the founders up the range. You make the first introduction."],
        },
      ],
    },
    who: {
      heading: "Friendly, curious, true to your word",
      blocks: [
        {
          kind: "tiles",
          tiles: [
            { icon: "people", label: "You love meeting people", note: "And introducing them" },
            { icon: "hammer", label: "You love building", note: "And the people who build" },
            { icon: "pin", label: "You can reach Springs events", note: "Monument to Fountain" },
          ],
        },
        { kind: "lookFor", heading: "In the interview, Paul looks for" },
        { kind: "rules", heading: "Ground rules" },
      ],
    },
    apply: {
      heading: "Your path to the bronze doors",
      blocks: [{ kind: "steps" }, { kind: "courses" }, { kind: "apply", heading: APPLY_HEADING }],
    },
  },
};
