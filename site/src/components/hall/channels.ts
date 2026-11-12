// Where the community meets, with what to expect and the norms in each place.
// Owner: L1. Rendered on /community/; the first four are also the home
// page's ways in (ways.ts).
//
// The norms restate the Code of Conduct (LinkedIn W1 website-changes.md item 9)
// and the weekly threads in data/communitas/. If this file and the Code of
// Conduct page ever disagree, the Code of Conduct wins; fix this file in the
// same session.
import { WAYS_IN } from "@cs/shared";

// Micah Mador and Lindsey Rohde run Startup Hikes, Startup Ski Days, Welcome
// to Boulder and Welcome to Denver here now (the Oct 6 announcement; LinkedIn
// W1 website-changes.md items 7 and 12).
export const STARTUP_COMMUNITY_PROJECT_URL = "https://luma.com/startup-community-project";

export interface Channel {
  id: string;
  name: string;
  expect: string;
  norms: string[];
  action: { label: string; href: string };
  /** A short stamped fact, one to three words, shown as a Badge. */
  badge?: string;
  /** A keeper that works in this channel. Its disclosure line renders beside the card. */
  keeper?: "communitas";
  /** An optional pointer to a related place, shown under the norms. */
  aside?: { text: string; label: string; href: string };
}

export const CHANNELS: readonly Channel[] = [
  {
    id: "slack",
    name: "Slack",
    expect:
      "Everyday conversation with founders across Colorado. Ask for help, introduce yourself, find a cofounder or a first hire.",
    norms: [
      "Follow the Code of Conduct.",
      "Say hello in the Monday Welcome thread and tell us what you are building.",
      "Share your company, product, service or open role in the Wednesday Asks and Offers thread, and nowhere else.",
      "Post your wins in the Friday Colorado Wins thread.",
      "Communitas sends one welcome note and answers when you mention it. People moderate.",
    ],
    action: { label: "Join the Slack", href: WAYS_IN.slack },
    keeper: "communitas",
  },
  {
    id: "linkedin-group",
    name: "LinkedIn Group",
    expect:
      "Three weekly threads: Monday Welcome, Wednesday Asks and Offers, and Friday Colorado Wins. A person approves each new member.",
    norms: [
      "Follow the Code of Conduct.",
      "Share your company, product, service or open role in the Wednesday Asks and Offers thread, and nowhere else.",
      "Post your wins in the Friday Colorado Wins thread.",
      "Keep posts about building companies in Colorado.",
    ],
    action: { label: "Join the LinkedIn Group", href: WAYS_IN["linkedin-group"] },
  },
  {
    id: "linkedin-page",
    name: "LinkedIn Page",
    expect: "Founder wins and Colorado Startups news, in your LinkedIn feed.",
    norms: ["A person at Colorado Startups reviews and publishes every post.", "Comments follow the Code of Conduct."],
    action: { label: "Follow the LinkedIn Page", href: WAYS_IN["linkedin-page"] },
  },
  {
    id: "newsletter",
    name: "The Startupers newsletter",
    expect: "News from the Hall in your inbox: founder wins, new resources and Leaderboard editions.",
    norms: ["Every email has a link to unsubscribe."],
    action: { label: "Get the newsletter", href: WAYS_IN.newsletter },
  },
  {
    id: "events",
    name: "Events",
    expect: "Meetups and community events across the Front Range, on one calendar.",
    norms: ["Check each event's own page for its host, time and place before you go."],
    action: { label: "See the event calendar", href: WAYS_IN.events },
    aside: {
      text: "Looking for Startup Hikes or Startup Ski Days? Micah Mador and Lindsey Rohde run them through their Startup Community Project.",
      label: "Visit the Startup Community Project",
      href: STARTUP_COMMUNITY_PROJECT_URL,
    },
  },
  {
    id: "founders-forum",
    name: "Founders forum",
    expect: "A private forum for founders only. It opens later.",
    norms: ["Only founders can join.", "People will moderate it."],
    action: { label: "Read about the founders forum", href: WAYS_IN.discourse },
    badge: "Coming later",
  },
];
