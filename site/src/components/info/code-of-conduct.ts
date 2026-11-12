// The Code of Conduct, as data, so the page and its tests read one copy.
// Owner: L13.
//
// Source: the live page at coloradostartups.org/code-of-conduct (read
// 2026-10-18), with the replacements in the LinkedIn project's
// W1-page-kit/website-changes.md item 9: "Find Talent" through "No Cold
// Pitches" are its wording, verbatim. Every other rule keeps the live wording,
// with three mechanical fixes for the house rules:
//   - two exclamation marks became periods (voice.md: at most one a page);
//   - a comma splice in "Engage Initially" became a colon;
//   - the intro drops its unsourced member count and the retired LaunchPass
//     and Facebook links, and names the Slack and the LinkedIn Group instead.

interface ConductRule {
  title: string;
  body: string[];
}

export interface ConductGroup {
  id: string;
  heading: string;
  rules: ConductRule[];
}

export const CONDUCT_INTRO =
  "Colorado Startups has grown from a handful of entrepreneurs into a community of Startupers across Colorado. " +
  "These posting guidelines keep our groups useful for everyone. " +
  "Please read them before you post in the Slack or the LinkedIn Group.";

export const CONDUCT_GROUPS: ConductGroup[] = [
  {
    id: "how-we-treat-each-other",
    heading: "How we treat each other",
    rules: [
      {
        title: "Engage Initially",
        body: [
          "The more you engage, the more you will get from this group. First, invite your friends to the social groups: the more, the merrier. The more you react, comment, and post, the more likely you are to create connections.",
        ],
      },
      {
        title: "Focus on Startups in Colorado",
        body: ["Posts should be about building and supporting the next generation of companies here in Colorado."],
      },
      {
        title: "Be Kind and Courteous",
        body: [
          "This community is a welcoming environment; we're all on the startup roller coaster together. Let's treat everyone with respect. Degrading comments will not be tolerated. Healthy debates are natural, but kindness is required.",
          "Any form of harassment witnessed or reported will not be tolerated and result in removal from the community.",
        ],
      },
    ],
  },
  {
    id: "what-to-post",
    heading: "What to post",
    rules: [
      {
        title: "Promote Events",
        body: ["Posts about events in the community (#events) that bring entrepreneurs together are encouraged."],
      },
      {
        title: "Request Help",
        body: ["Posts asking for help, a recommendation, or a resource for building your company are encouraged."],
      },
      {
        title: "Offer Help",
        body: ["Posts offering help or resources are strongly encouraged."],
      },
      {
        title: "Find Mentors",
        body: ["Posts looking for mentors or offering mentorship are strongly encouraged."],
      },
      {
        title: "Find Talent",
        body: [
          "Startups hiring in Colorado are welcome to share open roles in each group's designated weekly thread. In the LinkedIn Group, that is the Wednesday Asks and Offers thread.",
        ],
      },
      {
        title: "Create Polls",
        body: ["Posts with polls for idea validation, market research, and general feedback are encouraged."],
      },
      {
        title: "Celebrate Wins",
        body: [
          "Posts about celebrations and major PR stories are encouraged, and so is any press that gives Colorado positive exposure. In the LinkedIn Group, wins go in the Friday Colorado Wins thread.",
        ],
      },
    ],
  },
  {
    id: "promotion-and-limits",
    heading: "Promotion and limits",
    rules: [
      {
        title: "Promote in One Place",
        body: [
          "Service providers and product builders matter to this community. Self-promotion goes only in each group's designated weekly thread. That covers your own company, product, service or open job. It also covers Product Hunt launches and rewards crowdfunding (Kickstarter, Indiegogo). In the LinkedIn Group, the thread is Wednesday Asks and Offers.",
        ],
      },
      {
        title: "No Investment Offers",
        body: [
          "Investment solicitation is never allowed. Don't pitch a fund, SPV, syndicate or open round. Equity crowdfunding (Wefunder, Republic, StartEngine and similar) counts as an investment offer. A closed raise can be shared as a win, with no link to invest.",
        ],
      },
      {
        title: "No Cold Pitches",
        body: ["Don't use the groups to message members with sales pitches. If it happens to you, tell an admin."],
      },
    ],
  },
];
