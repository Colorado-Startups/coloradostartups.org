// The /contribute/ page, as data, so the page and its tests read one copy.
// Open-source plan (#552): the page explains how ideas flow, how to run the
// site, how AI review works and that merges reach staging first. Its copy says
// "contributor" (decision 44).
//
// CONTRIBUTE_LIVE turned on on 2026-11-12, when this public repo opened to
// contributors. Off, the route builds no page.

/** The page is live: the repo is public and takes contributions. */
export const CONTRIBUTE_LIVE = true;

/** The route's static paths: the one /contribute/ page when live, none when not. */
export function contributePaths(live: boolean): { params: { path: undefined } }[] {
  return live ? [{ params: { path: undefined } }] : [];
}

/** The public repo. */
export const REPO_URL = "https://github.com/Colorado-Startups/coloradostartups.org";
export const DISCUSSIONS_URL = `${REPO_URL}/discussions/categories/ideas`;
export const GOOD_FIRST_ISSUES_URL = `${REPO_URL}/labels/good%20first%20issue`;
export const CONTRIBUTING_URL = `${REPO_URL}/blob/main/CONTRIBUTING.md`;

export const CONTRIBUTE_INTRO =
  "The code behind coloradostartups.org is open. Anyone with a good idea can improve the site and see it go live.";

export interface FlowStep {
  title: string;
  body: string;
}

/** How an idea reaches the live site, in order. */
export const FLOW: FlowStep[] = [
  { title: "Share the idea", body: "Start a discussion in Ideas. Say who it helps and what they do today." },
  { title: "It becomes an issue", body: "An accepted idea becomes an issue anyone can pick up." },
  { title: "Open a pull request", body: "Fork the repo, make one change with a test, and open a pull request." },
  {
    title: "Checks and AI review",
    body: "Tests run, and two AI agents review the code and its security. Agents never approve a pull request.",
  },
  { title: "Staging, then live", body: "A merge goes to staging first. A contributor's change waits 30 minutes there, then goes to coloradostartups.org." },
];

/** The three commands that run the site locally. */
export const RUN_COMMANDS = ["npm install", "git config core.hooksPath .githooks", "npm run dev"] as const;

export interface ReviewRow {
  change: string;
  merges: string;
}

/** Who merges which change (04_tools/merge_policy.json is the one definition). */
export const REVIEW_ROWS: ReviewRow[] = [
  {
    change: "Site content: events, regions, resources, positions, dispatches and credits",
    merges: "An AI agent merges it, once the checks and both AI reviews pass",
  },
  {
    change: "Code, styles, tests, dependencies, build settings, CI, gates, team data, art and the repo's own rules",
    merges: "An AI agent rebuilds the change in its own pull request, with you credited as co-author",
  },
];
