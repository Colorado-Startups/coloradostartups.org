// Line icons for /community/'s channel tiles and house rules. Drawn on a
// 24-unit grid, stroked in currentColor. Each sits beside words that say the
// same thing, so each is aria-hidden.
import type { ChannelIcon } from "../hall/channels";

export type RuleIcon = "one-place" | "no-invest" | "no-pitch";

const PATHS: Record<ChannelIcon | RuleIcon, string> = {
  chat: '<path d="M4 5h16v10H10l-6 4z"/><path d="M8 9h8M8 12h5"/>',
  people:
    '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2A5 5 0 0 1 21 19"/>',
  megaphone: '<path d="M3 10v4h3l8 4.5v-13L6 10z"/><path d="M17.5 9a4 4 0 0 1 0 6M20 6.5a7.5 7.5 0 0 1 0 11"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  "one-place": '<path d="M12 21s-6-5.4-6-11a6 6 0 0 1 12 0c0 5.6-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
  "no-invest":
    '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.3A2.6 2.6 0 0 0 12 8c-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2a2.7 2.7 0 0 1-2.6-1.4M12 6.5V8M12 16v1.5"/><path d="m5.6 5.6 12.8 12.8"/>',
  "no-pitch": '<path d="M4 5h16v10H10l-6 4z"/><path d="m3 3 18 18"/>',
};

/** One icon as an inline SVG string. */
export function communityIcon(name: ChannelIcon | RuleIcon): string {
  return (
    '<svg class="community-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" ' +
    `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`
  );
}
