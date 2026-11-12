// The /contribute/ page, as data, so the page and its tests read one copy.
// Open-source plan (#552): the page explains how ideas flow, how to run the
// site, how AI review works and that merges reach staging first. Its copy says
// "contributor" (decision 44).
//
// CONTRIBUTE_LIVE stays false until phase 6, when the public repo exists: the
// route then builds no page, so nothing points at a repo that is not there
// yet. Production deploys every green main commit (deploy-gate.yml),
// so merging this file publishes nothing while the flag is false.

/** Phase 6 sets this to true, with the repo name Paul picked in REPO_URL. */
export const CONTRIBUTE_LIVE = false;

/** The route's static paths: the one /contribute/ page when live, none when not. */
export function contributePaths(live: boolean): { params: { path: undefined } }[] {
  return live ? [{ params: { path: undefined } }] : [];
}

/** The public repo. The plan's suggested name until Paul picks one. */
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
  { title: "It becomes an issue", body: "A maintainer turns an accepted idea into an issue anyone can pick up." },
  { title: "Open a pull request", body: "Fork the repo, make one change with a test, and open a pull request." },
  {
    title: "Checks and AI review",
    body: "Tests run, and two AI agents review the code and its security. A maintainer reviews anything outside the AI-mergeable list.",
  },
  { title: "Staging, then live", body: "A merge goes to staging first, then to coloradostartups.org." },
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
    change: "Pages, components, styles, tests and most site content",
    merges: "An AI agent, once the checks and both AI reviews pass",
  },
  {
    change: "Dependencies, build settings, CI, gates, Workers, team data, art and the repo's own rules",
    merges: "A maintainer",
  },
];
