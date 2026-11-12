// The header's primary nav (SiteHeader.astro), kept apart from the markup so
// test/dom/header/nav-items.test.ts can check the list and the current-page
// test without a build. "Startup Resources" opens the Ecosystem Canvas, whose
// URL stays put because Communitas links its stage anchors (decisions 33c and
// 46). The guides answer questions from the same directory, so a guide page
// marks Startup Resources as current (card #150).
import { GUIDES_INDEX } from "../../lib/guides/guides";

export interface NavItem {
  href: string;
  label: string;
  /** Other sections that belong to this item, so their pages mark it current. */
  also?: readonly string[];
}

export const NAV: readonly NavItem[] = [
  { href: "/community/", label: "Community" },
  { href: "/ecosystem-canvas/", label: "Startup Resources", also: [GUIDES_INDEX.path] },
  { href: "/leaderboard/", label: "Leaderboard" },
  { href: "/regions/", label: "Regions" },
  { href: "/team/", label: "Team" },
  { href: "/get-involved/", label: "Get involved" },
];

/** True when the page at `pathname` sits in this item's section. */
export function isCurrent(item: NavItem, pathname: string): boolean {
  return [item.href, ...(item.also ?? [])].some((prefix) => pathname.startsWith(prefix));
}
