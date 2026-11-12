// The Leaderboard's sector vocabulary. One list for the company records, the
// nomination form's select, the server-side check and the sector-mix chart, so
// a sector cannot be added in one place and missed in another.
// test/unit/l2/data.test.ts asserts every company file uses one of these.
//
// A company gets the industry it serves, not the technology it uses: an AI
// tutoring app is "Education". "AI and data" is for products that are AI or
// data infrastructure themselves.
export const SECTORS = [
  "AI and data",
  "Software",
  "Cybersecurity",
  "Cloud and infrastructure",
  "Space and aerospace",
  "Defense and public safety",
  "Energy and climate",
  "Materials and manufacturing",
  "Hardware and robotics",
  "Quantum and photonics",
  "Health care",
  "Life sciences",
  "Fintech and insurance",
  "Education",
  "Consumer and retail",
  "Food and beverage",
  "Travel, hospitality and events",
  "Real estate and construction",
  "Media and entertainment",
  "Logistics and mobility",
  "Nonprofit and community",
] as const;

export type Sector = (typeof SECTORS)[number];

const SECTOR_SET: ReadonlySet<string> = new Set(SECTORS);

// True when the value is one of the SECTORS, and narrows it to Sector.
export function isSector(value: string): value is Sector {
  return SECTOR_SET.has(value);
}
