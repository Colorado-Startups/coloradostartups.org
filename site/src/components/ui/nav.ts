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

// The order follows a first visit (redesign, 2026-11-15): where, what to use,
// who builds here, when to meet, the people, then asking the data. Team, Get
// involved and the newsletter sit under Community; the footer lists them too.
export const NAV: readonly NavItem[] = [
  { href: "/regions/", label: "Regions" },
  { href: "/ecosystem-canvas/", label: "Startup Resources", also: [GUIDES_INDEX.path] },
  { href: "/leaderboard/", label: "Leaderboard" },
  { href: "/event-calendar/", label: "Events" },
  { href: "/community/", label: "Community", also: ["/team/", "/get-involved/", "/newsletter/"] },
  { href: "/ask/", label: "Ask" },
];

/** True when the page at `pathname` sits in this item's section. */
export function isCurrent(item: NavItem, pathname: string): boolean {
  return [item.href, ...(item.also ?? [])].some((prefix) => pathname.startsWith(prefix));
}
