// Communitas contracts: the ways in, visitor kinds, welcome routes and thread openers.

import * as z from "zod";

import { STAGES } from "./resource";

// The ways into the community that Communitas can recommend. Each kind maps to
// one canonical URL in WAYS_IN, so a route can never point somewhere new
// without a reviewed change here.
export const WAY_IN_KINDS = [
  "slack",
  "linkedin-group",
  "linkedin-page",
  "newsletter",
  "events",
  "canvas",
  "leaderboard",
  "discourse",
  "guide-start",
  "guide-accelerators",
] as const;
export type WayInKind = (typeof WAY_IN_KINDS)[number];

export const WAYS_IN: Record<WayInKind, string> = {
  // The one public Slack entry point (LinkedIn project decisions 30 and 35): a
  // short link that ops/redirects/map.csv sends to the sign-up form, so one
  // click on "Join the Slack" opens it (#128).
  slack: "/slack/",
  "linkedin-group": "https://www.linkedin.com/groups/6786402",
  "linkedin-page": "https://www.linkedin.com/company/costartups",
  newsletter: "/newsletter/",
  events: "/event-calendar/",
  canvas: "/ecosystem-canvas/",
  leaderboard: "/leaderboard/",
  // The founders-only forum opens after launch; until then this page explains
  // it (decision 49).
  discourse: "/founders/",
  // The founder guides behind the idea and building doors (card #150). Each
  // path is guidePath() of a slug in site/src/lib/guides/guides.ts, and
  // site/test/unit/l5/route-guides.test.ts fails if the slug moves.
  "guide-start": "/guides/start-a-company-in-colorado/",
  "guide-accelerators": "/guides/colorado-accelerators-and-incubators/",
};

// The welcome desk's answers. Who the visitor is maps to what Communitas
// recommends. Compiled at build time into a static island: no API, no model.
// Order is the order of the doors (decision 46): founders first, then the
// startup community that backs them, then students and the curious.
export const VISITOR_KINDS = [
  // Founders
  "idea",
  "building",
  "hiring",
  // The startup community: talent, capital (VCs and banks), service providers
  "talent",
  "investing",
  "service-provider",
  // Everyone else
  "student",
  "curious",
] as const;
export type VisitorKind = (typeof VISITOR_KINDS)[number];

export const RecommendationSchema = z.object({
  kind: z.enum(WAY_IN_KINDS),
  note: z.string().min(1).max(200),
  canvas_stage: z.enum(STAGES).optional(),
});

export const WelcomeRouteSchema = z.object({
  id: z.enum(VISITOR_KINDS),
  label: z.string().min(1).max(60),
  recommends: z.array(RecommendationSchema).min(1).max(5),
});
export type WelcomeRoute = z.infer<typeof WelcomeRouteSchema>;

// Slack weekly thread openers. Paul approves the library once; the cron only
// posts entries from it.
export const ThreadOpenerSchema = z.object({
  id: z.string(),
  day: z.enum(["mon", "wed", "fri"]),
  title: z.string().max(80),
  body: z.string().max(1200),
});
export type ThreadOpener = z.infer<typeof ThreadOpenerSchema>;
