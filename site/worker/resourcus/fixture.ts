// TEST FIXTURE. Twenty fictional resources on example.org. Two users: the
// vitest suites (tests import it, and the worker pool's runtime falls back to
// it because site/vitest.config.ts sets RESOURCUS_ALLOW_FIXTURE) and
// evals/resourcus/cli.ts. Production reads /data/resources.json. Nothing here
// is public, and every name is invented so a fixture can never be mistaken
// for a real recommendation.

import type { ResourceCard } from "@cs/shared";

const card = (
  id: string,
  name: string,
  stage: ResourceCard["stage"],
  substage: string,
  city: string,
  type: ResourceCard["type"],
  description: string,
): ResourceCard => ({ id, name, url: `https://example.org/${id}`, stage, substage, city, type, description });

export const FIXTURE_CARDS: readonly ResourceCard[] = [
  card("fx-granite-founder-school", "Granite Founder School", "idea", "educate", "Boulder", "education", "Evening course on customer discovery for first-time founders."),
  card("fx-ridgeline-idea-lab", "Ridgeline Idea Lab", "idea", "validate", "Denver", "community", "Monthly session where founders test an idea with a room of peers."),
  card("fx-switchback-mentors", "Switchback Mentors", "idea", "validate", "Fort Collins", "nonprofit", "Volunteer mentors who review early ideas and pitch drafts."),
  card("fx-quarry-university-ventures", "Quarry University Ventures", "idea", "educate", "Golden", "university", "Campus program that helps students and faculty start companies."),
  card("fx-headframe-accelerator", "Headframe Accelerator", "launch", "develop", "Boulder", "accelerator", "Three-month program with mentors and a demo day for software startups."),
  card("fx-ore-cart-coworking", "Ore Cart Coworking", "launch", "develop", "Denver", "coworking", "Shared desks and meeting rooms with a founder community."),
  card("fx-tailings-legal-clinic", "Tailings Legal Clinic", "launch", "service-providers", "Denver", "service-provider", "Free office hours on incorporation, equity and contracts."),
  card("fx-assay-accounting", "Assay Accounting", "launch", "service-providers", "Colorado Springs", "service-provider", "Bookkeeping and tax help priced for pre-revenue startups."),
  card("fx-stamp-mill-angels", "Stamp Mill Angels", "launch", "investors", "Denver", "investor", "Angel group that hears pitches from pre-seed and seed companies."),
  card("fx-front-range-seed-fund", "Front Range Seed Fund", "launch", "investors", "Boulder", "investor", "Seed investor focused on software and hardware companies."),
  card("fx-smelter-grants-office", "Smelter Grants Office", "launch", "develop", "statewide", "government", "State grant program for early research and prototypes."),
  card("fx-alpine-growth-partners", "Alpine Growth Partners", "growth", "investors", "Denver", "investor", "Series A and B investor for companies with recurring revenue."),
  card("fx-high-country-talent", "High Country Talent", "growth", "service-providers", "Denver", "service-provider", "Recruiting firm for engineering and go-to-market hires."),
  card("fx-crucible-scaleup-program", "Crucible Scaleup Program", "growth", "service-providers", "Boulder", "accelerator", "Peer program for founders scaling past their first fifty hires."),
  card("fx-bedrock-export-desk", "Bedrock Export Desk", "growth", "service-providers", "statewide", "government", "Help selling into new countries, from licensing to logistics."),
  card("fx-anvil-founder-dinners", "Anvil Founder Dinners", "support", "evangelists", "Denver", "event", "Small dinners that connect founders with experienced operators."),
  card("fx-lantern-startup-news", "Lantern Startup News", "support", "evangelists", "online", "media", "Weekly newsletter covering Front Range startup news."),
  card("fx-summit-founders-network", "Summit Founders Network", "support", "organizations", "statewide", "community", "Member network for founders across the state."),
  card("fx-piton-women-founders", "Piton Women Founders", "support", "organizations", "Denver", "community", "Community and programs for women building companies."),
  card("fx-cairn-open-tools", "Cairn Open Tools", "support", "organizations", "online", "tool", "Free templates for pitch decks, cap tables and hiring plans."),
];
