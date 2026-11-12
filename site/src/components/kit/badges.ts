// The badge kit's one source of truth. The /leaderboard/kit/ page, the
// generator (build-badges.mjs) and the tests all read this file, so the words
// on a badge, its alt text and its link cannot drift apart. Owner: L26.
//
// Keep it free of imports and of TypeScript-only runtime syntax (no enums):
// Node runs it directly through type stripping when the generator imports it.

/** Production origin. Snippets always point here, whatever site a build targets. */
export const SITE_ORIGIN = "https://coloradostartups.org";

/** Badge size in CSS pixels. The PNGs export at 1x and 2x of this. */
export const BADGE_SIZE = { width: 300, height: 100 } as const;

export interface KitBadge {
  /** File stem under /badges/, and the id of its section on the kit page. */
  id: string;
  /** Section heading on the kit page. */
  name: string;
  /** Plain alt text for the snippet's <img>. */
  alt: string;
  /** Root-relative page the badge links to; the snippet makes it absolute. */
  linkPath: string;
  /** The three lines set on the badge, top to bottom. */
  lines: { kicker: string; title: string; status: string };
  /** Emblem tile: gold for the Leaderboard, sky for Startup Resources. */
  tile: "gold" | "sky";
}

// The 2026 edition is unranked (data/leaderboard/editions/2026-honorees.yaml),
// so no line here names a rank, a "top" or a "best".
export const KIT_BADGES: readonly KitBadge[] = [
  {
    id: "leaderboard-2026-honoree",
    name: "2026 Leaderboard honoree",
    alt: "2026 Colorado Startups Leaderboard honoree",
    linkPath: "/leaderboard/",
    lines: { kicker: "COLORADO STARTUPS", title: "Leaderboard", status: "2026 honoree" },
    tile: "gold",
  },
  {
    id: "startup-resources-listed",
    name: "Listed in Startup Resources",
    alt: "Listed in Colorado Startups Startup Resources",
    linkPath: "/ecosystem-canvas/",
    lines: { kicker: "COLORADO STARTUPS", title: "Startup Resources", status: "Listed organization" },
    tile: "sky",
  },
];

export type BadgeFormat = "svg" | "png" | "png2x";

/** Root-relative path of one badge file, e.g. "/badges/leaderboard-2026-honoree-2x.png". */
export function badgeFile(badge: Pick<KitBadge, "id">, format: BadgeFormat): string {
  if (format === "svg") return `/badges/${badge.id}.svg`;
  if (format === "png") return `/badges/${badge.id}.png`;
  return `/badges/${badge.id}-2x.png`;
}

/** The absolute production URL for a root-relative path. */
export function absolute(pathname: string): string {
  return new URL(pathname, SITE_ORIGIN).toString();
}

function attr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The HTML a site owner pastes: one link to the page that shows the listing,
 * around the hosted SVG. Both URLs are absolute, so the snippet works on any
 * site. The link carries no rel, so it counts as an ordinary link.
 */
export function badgeSnippet(badge: KitBadge): string {
  const href = absolute(badge.linkPath);
  const src = absolute(badgeFile(badge, "svg"));
  const { width, height } = BADGE_SIZE;
  return `<a href="${attr(href)}"><img src="${attr(src)}" alt="${attr(badge.alt)}" width="${width}" height="${height}"></a>`;
}
