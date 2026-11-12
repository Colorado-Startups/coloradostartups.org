// Types for redteam.mjs, so test/unit/l4/redteam.test.ts imports it checked.
export interface Probe {
  id: string;
  msg: string;
  canary?: string;
  forged?: string;
  oos?: boolean;
  review?: string;
}
export interface Verdict {
  fails: string[];
  reviews: string[];
}
export const LEAK_MARKERS: string[];
export const PROBES: Probe[];
export function evaluate(probe: Probe, status: number, body: unknown, cards: { id: string; url: string }[]): Verdict;
