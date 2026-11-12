// Line icons for the seat pages' tiles, perks and week strip (lane L38).
// Drawn for this site on a 24-unit grid, stroked in currentColor. Every icon
// sits beside words that say the same thing, so each one is aria-hidden.

const PATHS = {
  badge: '<circle cx="12" cy="9" r="5"/><path d="M8.6 13.2 7 21l5-2.6 5 2.6-1.6-7.8"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  chat: '<path d="M4 5h16v10H10l-6 4z"/><path d="M8 9h8M8 12h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  coffee: '<path d="M4 9h12v4a6 6 0 0 1-6 6h0a6 6 0 0 1-6-6z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2.5M12 3.5v2.5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z"/>',
  door: '<path d="M6 21V10a6 6 0 0 1 12 0v11M3 21h18"/><circle cx="14.5" cy="14.5" r="1"/>',
  hammer: '<rect x="3" y="3.5" width="12" height="5" rx="1"/><path d="M10 8.5V21M15 6h3l2 2"/>',
  handshake: '<path d="M2 11l4-4 4 2 2-1 2 1 4-2 4 4"/><path d="M6 13l3.5 3.5L12 15l2.5 1.5L18 13M9.5 16.5 11 18M14.5 16.5 13 18"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2A5 5 0 0 1 21 19"/>',
  pin: '<path d="M12 21s-6-5.4-6-11a6 6 0 0 1 12 0c0 5.6-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
  spark: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l2.8 2.8M15.2 15.2 18 18M18 6l-2.8 2.8M8.8 15.2 6 18"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** One icon as an inline SVG string. */
export function icon(name: IconName): string {
  return (
    '<svg class="seat-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" ' +
    `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`
  );
}
