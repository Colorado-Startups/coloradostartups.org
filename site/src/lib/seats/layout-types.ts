// The seat layouts' types, section order and shared fact lists (layouts.ts and
// layouts/<seat>.ts). Every page answers the kit README's five questions in
// SECTION_ORDER, so a page cannot skip or swap one.
import type { IconName } from "./icons";
import type { MapRegion, NetworkSeat } from "./viz";

export const SECTION_ORDER = ["get", "network", "colorado", "who", "apply"] as const;
export type SectionKey = (typeof SECTION_ORDER)[number];

interface Tile {
  icon: IconName;
  label: string;
  note?: string;
}

interface Day {
  name: string;
  icon: IconName;
  /** A thread day is lit, and names its thread. */
  thread?: string;
  label: string;
}

/** One side of the keeper-and-you flow. The keeper's card takes its name and disclosure from dwarves.yaml. */
interface FlowCard {
  note?: string;
  lines: readonly string[];
}

export type Block =
  | { kind: "perks" }
  | { kind: "bars"; facts: readonly string[]; caption: string }
  | { kind: "stats"; facts: readonly string[] }
  | { kind: "map"; region: MapRegion; caption: string }
  | { kind: "network"; seat: NetworkSeat; caption: string }
  | { kind: "tiles"; tiles: readonly Tile[]; caption?: string }
  | { kind: "week"; label: string; days: readonly Day[]; caption: string }
  | { kind: "keeperFlow"; keeper: FlowCard; you: FlowCard & { title: string; icon: IconName } }
  | { kind: "plaque"; title?: string; lines: readonly string[]; pills?: readonly string[] }
  /** A plaque that ends with roles.json's org.lead, such as "You work with Paul Foley, Founder & President." */
  | { kind: "leadPlaque"; before: string }
  | { kind: "lede"; text: string }
  | { kind: "note"; text: string }
  | { kind: "split"; left: readonly Block[]; right: readonly Block[] }
  | { kind: "bring"; heading: string }
  | { kind: "lookFor"; heading: string }
  | { kind: "rules"; heading: string }
  | { kind: "steps" }
  | { kind: "courses"; intro?: string }
  | { kind: "apply"; heading: string };

interface Section {
  heading: string;
  blocks: readonly Block[];
}

export interface SeatLayout {
  hero: {
    /** Asset key under src/assets/art: art the site already ships. */
    art: string;
    alt: string;
    kicker: string;
    pills: readonly string[];
    cta: string;
  };
  sections: Readonly<Record<SectionKey, Section>>;
}

export const WEAK_TIES = ["weak-ties-often", "weak-ties-occasionally", "weak-ties-rarely"] as const;
export const APPLICATIONS = ["co-business-applications-2019", "co-business-applications"] as const;
export const APPLY_HEADING = "Badges in hand? Apply here.";
