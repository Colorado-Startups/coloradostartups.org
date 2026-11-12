// Look anchors for the three keepers, from art/DIRECTION.md ("The keepers").
// Who each keeper is lives in data/team/dwarves.yaml; this file holds only what
// the art needs: the kind of folk, the color anchor, and where the light sits.
// All three are AI agents run by Colorado Startups.

export type KeeperId = "communitas" | "resourcus" | "publicus";

export interface KeeperArt {
  kind: "dwarf" | "gnome";
  /** CSS color for the placeholder ring and small-portrait glow. */
  anchor: string;
  /** Where the keeper's lantern or lamp sits in the large portrait, as CSS percentages. */
  glow: { x: string; y: string };
}

/** The kind as its badge reads, on the home page and on /team/. */
export const KIND_LABELS: Record<KeeperArt["kind"], string> = { dwarf: "Dwarf", gnome: "Gnome" };

// Glow positions are read off the batch 1 picks (art/concepts/README.md): the
// lantern in Communitas's hands, the map room's hanging lamp over Resourcus,
// and the print shop's lantern above Publicus.
export const KEEPERS: Record<KeeperId, KeeperArt> = {
  communitas: { kind: "dwarf", anchor: "var(--c-community)", glow: { x: "45%", y: "85%" } },
  resourcus: { kind: "gnome", anchor: "var(--c-pine)", glow: { x: "64%", y: "25%" } },
  publicus: { kind: "dwarf", anchor: "var(--c-fire)", glow: { x: "52%", y: "25%" } },
};

/** Alt text that names the keeper and says it is an AI agent. */
export function portraitAlt(id: KeeperId, name: string, title: string): string {
  return `${name}, ${title}: an AI agent, painted as a ${KEEPERS[id].kind} of the Hall.`;
}

/**
 * Alt text for the Great Hall picture (src/assets/art/hero/hall). Dwarf and
 * gnome keepers carry lanterns among the founders there (art/prompts/hero-a.txt),
 * so every place that shows it says they are AI agents (#714). One constant,
 * so the alts never drift apart.
 */
export const HALL_ART_ALT =
  "An illustrated golden hall in the Front Range where founders work at long tables, with dwarf and gnome keepers, the site's AI agents, among them.";

/**
 * Alt text for each region's scene (src/assets/art/regions/<id>). Dwarf and
 * gnome keepers work among the founders in all three (art/prompts/region-*.txt),
 * so every place that shows one says they are AI agents (#761). RegionArt and
 * the Connector seat heroes read these, so the alts never drift apart.
 */
export const REGION_ART_ALT = {
  "photon-mountain":
    "A crystal-and-brass workshop carved into the foothills above Boulder, where founders build machines that compute with light, with dwarf and gnome keepers, the site's AI agents, helping them.",
  "space-peak":
    "An observatory workshop above Colorado Springs, under Pikes Peak, where founders work beside a great brass telescope, with gnome and dwarf keepers, the site's AI agents, among them.",
  "fusion-canyon":
    "A forge-workshop at Fort Collins, where founders work around a small sun in a brass ring, with dwarf and gnome keepers, the site's AI agents, tuning its coils.",
} as const satisfies Readonly<Record<string, string>>;

export type RegionArtId = keyof typeof REGION_ART_ALT;

/** A region scene's alt. Throws for a region with no entry, so no scene ships an undisclosed alt. */
export function regionArtAlt(id: string): string {
  const alt = (REGION_ART_ALT as Readonly<Record<string, string>>)[id];
  if (!alt) throw new Error(`no REGION_ART_ALT entry for region "${id}" (components/art/keepers.ts, #761)`);
  return alt;
}

/** Asset keys under src/assets/art for a keeper's two crops (Wave 0b: `portrait: agents/<id>`). */
export function portraitKeys(id: KeeperId): { large: string; small: string } {
  return { large: `agents/${id}`, small: `agents/${id}-small` };
}
