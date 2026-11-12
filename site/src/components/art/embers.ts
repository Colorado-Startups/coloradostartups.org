// Fixed ember layout for the drift effect. Fixed, not random, so every build
// renders the same markup. Each ember rises from the bottom band of the image.
export interface Ember {
  /** Horizontal start, percent of the box width. */
  x: number;
  /** Seconds before the rise; staggers the embers. */
  delay: number;
  /** Seconds for the one rise. */
  duration: number;
  /** Diameter in px. */
  size: number;
  /** Sideways drift over one rise, in px. */
  drift: number;
}

// Each ember rises once: delay plus duration stays at or under 4.8 seconds, so
// all motion ends within the 5 seconds WCAG 2.2.2 allows without a pause control.
export const EMBERS: readonly Ember[] = [
  { x: 12, delay: 0.0, duration: 3.6, size: 4, drift: 14 },
  { x: 27, delay: 0.6, duration: 3.2, size: 3, drift: -10 },
  { x: 41, delay: 1.1, duration: 3.6, size: 5, drift: 18 },
  { x: 56, delay: 0.3, duration: 3.4, size: 3, drift: -16 },
  { x: 68, delay: 0.9, duration: 3.5, size: 4, drift: 12 },
  { x: 81, delay: 1.2, duration: 3.0, size: 3, drift: -8 },
  { x: 92, delay: 0.4, duration: 3.3, size: 4, drift: 10 },
];

export function emberStyle(e: Ember): string {
  return `--x:${e.x}%;--d:${e.delay}s;--t:${e.duration}s;--size:${e.size}px;--dx:${e.drift}px`;
}
