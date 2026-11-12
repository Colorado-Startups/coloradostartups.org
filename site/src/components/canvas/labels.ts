// Words the directory shows for schema values. Owner: L3. The values come
// from @cs/shared; only their display text lives here.
import type { ResourceCard, Stage } from "@cs/shared";

export const STAGE_LABELS: Record<Stage, string> = {
  idea: "Idea",
  launch: "Launch",
  growth: "Growth",
  support: "Support",
};

// One plain sentence per level of the journey, written for this page.
export const STAGE_SUMMARIES: Record<Stage, string> = {
  idea: "Get inspired, learn the basics, test an idea and find a team.",
  launch: "Build the company, raise a first round and find the people who help you start.",
  growth: "Raise growth rounds and find partners who help you scale.",
  support: "Organizations that help founders at every stage.",
};

export const SUBSTAGE_LABELS: Record<string, string> = {
  educate: "Educate",
  validate: "Validate",
  develop: "Develop",
  investors: "Investors",
  "service-providers": "Service providers",
  evangelists: "Evangelists",
  organizations: "Organizations",
};

export const TYPE_LABELS: Record<ResourceCard["type"], string> = {
  accelerator: "Accelerator",
  incubator: "Incubator",
  coworking: "Coworking",
  education: "Education",
  event: "Event",
  community: "Community",
  investor: "Investor",
  "service-provider": "Service provider",
  government: "Government",
  university: "University",
  nonprofit: "Nonprofit",
  media: "Media",
  tool: "Tool",
  other: "Other",
};

export function cityLabel(city: string): string {
  if (city === "statewide") return "Statewide";
  if (city === "online") return "Online";
  return city;
}
