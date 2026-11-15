// The four channels a visitor picks from on /community/: the ways in.
// Owner: L1. ways.ts reads them as WAYS, and every href comes from WAYS_IN.
//
// Each tile says one short thing (Paul, 2026-11-15: visual first, few
// words). The norms live in the Code of Conduct; /community/ shows its three
// promotion rules as icons (components/info/code-of-conduct.ts). If a line here and the Code of
// Conduct page ever disagree, the Code of Conduct wins; fix this file in the
// same session.
import { WAYS_IN } from "@cs/shared";

// Micah Mador and Lindsey Rohde run Startup Hikes, Startup Ski Days, Welcome
// to Boulder and Welcome to Denver here now (the Oct 6 announcement; LinkedIn
// W1 website-changes.md items 7 and 12). /links/ points there.
export const STARTUP_COMMUNITY_PROJECT_URL = "https://luma.com/startup-community-project";

export type ChannelIcon = "chat" | "people" | "megaphone" | "mail";

export interface Channel {
  id: "slack" | "linkedin-group" | "linkedin-page" | "newsletter";
  name: string;
  /** One short line: what you get there. */
  expect: string;
  icon: ChannelIcon;
  action: { label: string; href: string };
}

export const CHANNELS: readonly Channel[] = [
  {
    id: "slack",
    name: "Slack",
    expect: "Everyday help from founders across Colorado.",
    icon: "chat",
    action: { label: "Join the Slack", href: WAYS_IN.slack },
  },
  {
    id: "linkedin-group",
    name: "LinkedIn Group",
    expect: "Weekly threads for welcomes, asks and wins.",
    icon: "people",
    action: { label: "Join the LinkedIn Group", href: WAYS_IN["linkedin-group"] },
  },
  {
    id: "linkedin-page",
    name: "LinkedIn Page",
    expect: "Founder wins and our news in your feed.",
    icon: "megaphone",
    action: { label: "Follow the LinkedIn Page", href: WAYS_IN["linkedin-page"] },
  },
  {
    id: "newsletter",
    name: "The Startupers newsletter",
    expect: "Wins and new resources in your inbox.",
    icon: "mail",
    action: { label: "Get the newsletter", href: WAYS_IN.newsletter },
  },
];
