// The slack community lead seat page's layout (layouts.ts holds all four).
import { HALL_ART_ALT } from "../../../components/art/keepers";
import { APPLY_HEADING, type SeatLayout } from "../layout-types";

export const SLACK_COMMUNITY_LEAD: SeatLayout = {
  hero: {
    art: "brand/golden",
    alt: HALL_ART_ALT,
    kicker: "Online, statewide",
    pills: [],
    cta: "See how to apply",
  },
  sections: {
    what: {
      heading: "An AI agent greets, you lead",
      blocks: [
        {
          kind: "keeperFlow",
          keeper: { lines: ["Welcomes each new member", "Opens the weekly threads", "Answers from Startup Resources"] },
          you: {
            title: "You",
            icon: "people",
            lines: ["Welcome people by name", "Keep each thread going", "Moderate by the Code of Conduct"],
          },
        },
        {
          kind: "week",
          label: "A week in the Colorado Startups Slack",
          days: [
            { name: "Monday", icon: "door", thread: "Monday Welcome", label: "Meet each new member" },
            { name: "Tuesday", icon: "chat", label: "Open channels" },
            { name: "Wednesday", icon: "handshake", thread: "Asks and Offers", label: "Match asks with offers" },
            { name: "Thursday", icon: "chat", label: "Open channels" },
            { name: "Friday", icon: "star", thread: "Colorado Wins", label: "Cheer launches and first customers" },
          ],
          caption: "Communitas, an AI agent, opens each thread. You keep it going.",
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
          left: [{ kind: "map", region: "all", caption: "One Slack for founders in every region." }],
          right: [{ kind: "stats", facts: ["deloitte-hiring"] }],
        },
      ],
    },
    apply: {
      heading: "Through the bronze doors",
      blocks: [
        { kind: "steps" },
        { kind: "courses", intro: "The third course is for working beside Communitas, our AI agent." },
        { kind: "apply", heading: APPLY_HEADING },
      ],
    },
  },
};
