// Text helpers for the seat pages (lane L38): the keeper disclosure on kit
// copy, and the bar widths for a chart of facts.

const KEEPER_NAMES = ["Communitas", "Resourcus", "Publicus"] as const;
const SENTENCE_END = /(?<=[.!?])\s+/;

/**
 * Every keeper is disclosed as an AI agent where it appears (BRIEF hard
 * constraint 10). The kit's roles.json is copied as written, and one of its
 * lines names Communitas without saying so in that sentence. This adds ", an
 * AI agent," after the first keeper name in any sentence that lacks the
 * words, and leaves every other sentence as it was.
 */
export function withKeeperDisclosure(text: string): string {
  return text
    .split(SENTENCE_END)
    .map((sentence) => {
      if (/\bAI agent\b/i.test(sentence)) return sentence;
      for (const name of KEEPER_NAMES) {
        const at = new RegExp(`\\b${name}\\b(,?)`).exec(sentence);
        if (!at) continue;
        const end = at.index + at[0].length;
        const next = sentence[end];
        const insert = next === undefined || /[.!?]/.test(next) ? `${name}, an AI agent` : `${name}, an AI agent,`;
        return sentence.slice(0, at.index) + insert + sentence.slice(end);
      }
      return sentence;
    })
    .join(" ");
}

/** A fact's value as a number for a bar's length: "82%" is 82, "143,807" is 143807. */
export function figureNumber(value: string): number {
  const m = /^\$?([\d,]+(?:\.\d+)?)\s*(%|million|billion)?\+?$/.exec(value.trim());
  if (!m) throw new Error(`bar chart: cannot chart the value "${value}"`);
  const n = Number(m[1]!.replace(/,/g, ""));
  return m[2] === "million" ? n * 1e6 : m[2] === "billion" ? n * 1e9 : n;
}

/**
 * Bar lengths in percent of the track, as the kit charts them: percentages
 * against 100, any other figures against the largest one.
 */
export function barWidths(values: readonly string[]): number[] {
  const nums = values.map(figureNumber);
  const percent = values.every((v) => v.trim().endsWith("%"));
  const top = percent ? 100 : Math.max(...nums);
  return nums.map((n) => Math.round((n / top) * 1000) / 10);
}
