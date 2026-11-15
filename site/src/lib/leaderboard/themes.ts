// The Leaderboard's theme chips: the three Why Colorado themes on the home
// page, each one edition sector, and everything else. A chip filters the
// honorees table; its count comes from the same rows the table draws. The
// colors are the home theme panels' (REGION_COLORS), so a theme looks the same
// on both pages. Every theme sector is a Sector, so a renamed sector stops the
// type check instead of leaving a chip at zero.
import type { RegionId } from "@cs/shared";

import { REGION_COLORS } from "../regions/map";
import type { Sector } from "./sectors";

export interface Theme {
  id: string;
  label: string;
  /** The theme's color, or null for Everything else. */
  color: string | null;
}

const NAMED: readonly { id: string; label: string; sector: Sector; region: RegionId }[] = [
  { id: "photonics", label: "Photonics and quantum", sector: "Quantum and photonics", region: "photon-mountain" },
  { id: "energy", label: "Energy and climate", sector: "Energy and climate", region: "fusion-canyon" },
  { id: "space", label: "Space and aerospace", sector: "Space and aerospace", region: "space-peak" },
];

export const OTHER_THEME = "other";

export const THEMES: readonly Theme[] = [
  ...NAMED.map((t) => ({ id: t.id, label: t.label, color: REGION_COLORS[t.region] })),
  { id: OTHER_THEME, label: "Everything else", color: null },
];

/** The theme a sector belongs to: a named theme's id, or OTHER_THEME. */
export function themeOf(sector: string): string {
  return NAMED.find((t) => t.sector === sector)?.id ?? OTHER_THEME;
}

/** Each theme with how many of `sectors` fall in it, in THEMES order. */
export function themeCounts(sectors: readonly string[]): (Theme & { count: number })[] {
  return THEMES.map((t) => ({ ...t, count: sectors.filter((s) => themeOf(s) === t.id).length }));
}
