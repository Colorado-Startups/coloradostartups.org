// The fusion canyon connector seat page's layout (layouts.ts holds all four).
import { REGION_ART_ALT } from "../../../components/art/keepers";
import { APPLICATIONS, APPLY_HEADING, WEAK_TIES, type SeatLayout } from "../layout-types";

export const FUSION_CANYON_CONNECTOR: SeatLayout = {
  hero: {
    art: "regions/fusion-canyon",
    alt: REGION_ART_ALT["fusion-canyon"],
    kicker: "Volunteer role · Fort Collins and Northern Colorado",
    pills: ["Fort Collins", "Loveland", "Windsor", "Greeley", "Your own schedule"],
    cta: "How to apply",
  },
  sections: {
    get: {
      heading: "What you carry home",
      blocks: [
        { kind: "perks" },
        {
          kind: "split",
          left: [
            {
              kind: "bars",
              facts: ["deloitte-skills", "deloitte-resume", "deloitte-hiring", "deloitte-leadership"],
              caption: "What volunteer work signals to the people who choose new staff.",
            },
          ],
          right: [{ kind: "stats", facts: ["cncs-job-odds"] }],
        },
      ],
    },
    network: {
      heading: "Links across the Front Range",
      blocks: [
        { kind: "lede", text: "New doors open through people you see now and then." },
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
            { kind: "bars", facts: WEAK_TIES, caption: "How often people saw the contact who led them to new work." },
            { kind: "stats", facts: ["weak-ties-linkedin"] },
          ],
        },
        { kind: "stats", facts: ["dist-fort-collins-denver", "dist-colorado-springs-fort-collins"] },
        { kind: "note", text: "How far your links reach along the Front Range." },
      ],
    },
    colorado: {
      heading: "Light the northern forge",
      blocks: [
        { kind: "lede", text: "Founders here are spread across the plain. You help them find each other." },
        {
          kind: "split",
          left: [
            {
              kind: "map",
              region: "fusion-canyon",
              caption: "Fusion Canyon: Fort Collins, Loveland, Windsor and Greeley, across Larimer and Weld counties.",
            },
          ],
          right: [
            {
              kind: "plaque",
              title: "Named for the canyon. Built on the plain.",
              lines: ["Fort Collins sits on the open plain, downstream of the Cache la Poudre canyon."],
            },
            { kind: "stats", facts: ["noco-population"] },
          ],
        },
        {
          kind: "split",
          left: [
            {
              kind: "bars",
              facts: ["pop-fort-collins", "pop-greeley", "pop-loveland", "pop-windsor"],
              caption: "People in each Fusion Canyon city.",
            },
          ],
          right: [{ kind: "bars", facts: APPLICATIONS, caption: "New business applications filed across Colorado." }],
        },
      ],
    },
    who: {
      heading: "The first friendly face",
      blocks: [
        {
          kind: "tiles",
          tiles: [
            { icon: "calendar", label: "Show up at startup events" },
            { icon: "door", label: "Greet the newcomer first" },
            { icon: "link", label: "Link founders across the range" },
            { icon: "coffee", label: "Coffee with people who help" },
            { icon: "chat", label: "Invite people to the Slack" },
            { icon: "star", label: "Share local wins" },
          ],
        },
        { kind: "bring", heading: "What you bring" },
        { kind: "lookFor", heading: "What Paul looks for" },
        { kind: "leadPlaque", before: "You work with" },
        { kind: "rules", heading: "Ground rules" },
      ],
    },
    apply: {
      heading: "Your way in",
      blocks: [{ kind: "steps" }, { kind: "courses" }, { kind: "apply", heading: APPLY_HEADING }],
    },
  },
};
