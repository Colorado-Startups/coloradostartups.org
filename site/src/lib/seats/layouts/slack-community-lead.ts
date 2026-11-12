// The slack community lead seat page's layout (layouts.ts holds all four).
import { HALL_ART_ALT } from "../../../components/art/keepers";
import { APPLY_HEADING, type SeatLayout } from "../layout-types";

export const SLACK_COMMUNITY_LEAD: SeatLayout = {
  hero: {
    art: "hero/hall",
    alt: HALL_ART_ALT,
    kicker: "Online, statewide",
    pills: [],
    cta: "See how to apply",
  },
  sections: {
    get: {
      heading: "What you carry home",
      blocks: [
        { kind: "perks" },
        { kind: "bars", facts: ["deloitte-skills", "deloitte-hiring"], caption: "What volunteer experience is worth on a résumé." },
      ],
    },
    network: {
      heading: "Every founder passes your door",
      blocks: [
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
        { kind: "plaque", lines: ["The wins you spot can reach the Startupers newsletter."] },
      ],
    },
    colorado: {
      heading: "One Slack, every outpost",
      blocks: [
        {
          kind: "split",
          left: [{ kind: "map", region: "all", caption: "The Slack joins every outpost, and founders anywhere in Colorado." }],
          right: [
            { kind: "stats", facts: ["co-business-applications"] },
            {
              kind: "plaque",
              lines: ["Founders in every outpost ask, answer and cheer in the same threads."],
              pills: ["Photon Mountain", "Fusion Canyon", "Space Peak", "Online"],
            },
          ],
        },
      ],
    },
    who: {
      heading: "An AI agent greets, you lead",
      blocks: [
        {
          kind: "keeperFlow",
          keeper: { lines: ["Welcomes each new member", "Opens the weekly threads", "Answers from Startup Resources"] },
          you: {
            title: "You",
            icon: "people",
            note: "The person who leads the room",
            lines: ["Welcome people by name", "Keep each thread going", "Moderate by the Code of Conduct"],
          },
        },
        {
          kind: "tiles",
          tiles: [
            { icon: "compass", label: "Point people to the right channel" },
            { icon: "spark", label: "Spot wins worth sharing" },
            { icon: "link", label: "Flag where the AI agent errs" },
            { icon: "hammer", label: "Shape new channels with Paul" },
          ],
        },
        { kind: "bring", heading: "What you bring" },
        { kind: "lookFor", heading: "In the interview, Paul looks for" },
        { kind: "rules", heading: "Ground rules" },
      ],
    },
    apply: {
      heading: "Through the bronze doors",
      blocks: [
        { kind: "steps" },
        { kind: "courses", intro: "This seat adds the course on human-agent teams, for working beside Communitas, our AI agent." },
        { kind: "apply", heading: APPLY_HEADING },
      ],
    },
  },
};
