// Build-time access to the active resources, grouped the way the directory
// shows them. Owner: L3. Only `status: active` records are public.
import { STAGES, SUBSTAGES, toCard, type ResourceCard, type Stage } from "@cs/shared";
import { getCollection } from "astro:content";

export async function activeCards(): Promise<ResourceCard[]> {
  const entries = await getCollection("resources", (e) => e.data.status === "active");
  return entries.map((e) => toCard(e.data)).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

export interface StageGroup {
  stage: Stage;
  total: number;
  substages: { substage: string; cards: ResourceCard[] }[];
}

/** Stages in journey order, each with its non-empty substages in schema order. */
export function groupByStage(cards: readonly ResourceCard[]): StageGroup[] {
  return STAGES.map((stage) => {
    const substages = SUBSTAGES[stage]
      .map((substage) => ({ substage, cards: cards.filter((c) => c.stage === stage && c.substage === substage) }))
      .filter((g) => g.cards.length > 0);
    return { stage, total: substages.reduce((n, g) => n + g.cards.length, 0), substages };
  });
}
