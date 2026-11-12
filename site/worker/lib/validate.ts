// Pure, runtime-agnostic input helpers for the form routes. Kept free of
// Workers imports so they unit-test in plain Node.

// Single-line fields are stripped of CR/LF so user input can never smuggle
// extra MIME headers into the message.
export function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

// True for text shaped like local@domain.tld. A shape check only: it never
// looks the address up.
export function isPlausibleEmail(value: string): boolean {
  // Deliberately simple shape check (local@domain.tld, no spaces, no CR/LF).
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}
