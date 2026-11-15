// Look anchors for the three keepers, from art/DIRECTION.md ("The keepers").
// Who each keeper is lives in data/team/dwarves.yaml; this file holds only what
// the art needs: the kind of folk, the color anchor, and where the light sits.
// All three are AI agents run by Colorado Startups.

export type KeeperId = "communitas" | "resourcus" | "publicus";

export interface KeeperArt {
  kind: "dwarf" | "gnome";
  /** CSS color for the placeholder ring and small-portrait glow. */
  anchor: string;
  /** Where the keeper's lantern sits in the large portrait, as CSS percentages; null when it holds none. */
  glow: { x: string; y: string } | null;
}

/** The kind as its badge reads, on the home page and on /team/. */
export const KIND_LABELS: Record<KeeperArt["kind"], string> = { dwarf: "Dwarf", gnome: "Gnome" };

// Glow positions are read off the brand v3 portraits (brand dist/hall/, decision
// 53, viewed 2026-11-15): the lantern on Communitas's pole, top left. Resourcus
// (compass and map) and Publicus (broadsheet) hold no light, so they get none.
export const KEEPERS: Record<KeeperId, KeeperArt> = {
  communitas: { kind: "dwarf", anchor: "var(--c-community)", glow: { x: "23%", y: "21%" } },
  resourcus: { kind: "gnome", anchor: "var(--c-pine)", glow: null },
  publicus: { kind: "dwarf", anchor: "var(--c-fire)", glow: null },
};

/** Alt text that names the keeper and says it is an AI agent. */
export function portraitAlt(id: KeeperId, name: string, title: string): string {
  return `${name}, ${title}: an AI agent, painted as a ${KEEPERS[id].kind}.`;
}

/**
 * Alt text for brand v3's place paintings, from the brand's own plain captions
 * (Colorado-Startups/brand data/world.yaml place_art, read 2026-11-14), so no
 * franchise word reaches the page. The crowds in them are community folk, not
 * the keepers, so these alts carry no AI-agent line; keeper portraits do
 * (portraitAlt above). One constant per picture, so the alts never drift apart.
 */
export const PLACE_ART_ALT = {
  boulder: "The Flatirons as an elven city of waterfalls, moon portals and a great tree, with dragons.",
  golden: "Table Mountain as a dwarven kingdom's forge gate, with steam carts and a boulder wyrm.",
  denver: "The Denver skyline behind a walled castle town, with knights on white horses and white gryphons.",
  springs: "Pikes Peak's rock spires as tower aeries, with gyrocopters and a gryphon.",
  fortcollins:
    "Poudre Canyon as a gnome workshop village of water wheels and round-door homes, with small dragons and mechanical striders.",
} as const;

/** The Hall picture: Golden's forge gate (brand/golden). */
export const HALL_ART_ALT = PLACE_ART_ALT.golden;

/** Each region's picture (data/regions/<id>.yaml art). RegionArt and the Connector seat heroes read these. */
export const REGION_ART_ALT = {
  "photon-mountain": PLACE_ART_ALT.boulder,
  "space-peak": PLACE_ART_ALT.springs,
  "fusion-canyon": PLACE_ART_ALT.fortcollins,
} as const;

export type RegionArtId = keyof typeof REGION_ART_ALT;

/** A region scene's alt. Throws for a region with no entry, so no scene ships an undisclosed alt. */
export function regionArtAlt(id: string): string {
  const alt = (REGION_ART_ALT as Readonly<Record<string, string>>)[id];
  if (!alt) throw new Error(`no REGION_ART_ALT entry for region "${id}" (components/art/keepers.ts, #761)`);
  return alt;
}

/** Art keys for a keeper's two pictures: the brand v3 portrait (960 x 1200) and its 320 x 320 crop (art-assets.ts brandArt). */
export function portraitKeys(id: KeeperId): { large: string; small: string } {
  return { large: `brand/${id}`, small: `brand/${id}-small` };
}
