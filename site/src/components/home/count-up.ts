// Count-up for a shown figure (step W1). The figure's own text always stays
// in the page; global.css draws a counting copy over it while it scrolls into
// view, then hands back to the text. This module only decides whether a
// figure can count and with what numbers. A figure counts when it is a whole
// number, plain ("143") or in comma groups ("6,012,561"), with an optional
// "$" before it and an optional "%" or "+" after it. Decimals, ordinals and
// words ("34.7%", "13th", "2 billion") show still.

export interface CountUp {
  /** The value it counts to. */
  to: number;
  /** Where it starts: 0 for a plain number, or the smallest number with the
      same comma groups, so "6,012,561" counts from 1,000,000 and never shows
      "0,012,345". */
  from: number;
  /** 1 for a plain number, else the comma groups, 2 to 4. */
  groups: number;
  prefix: string;
  suffix: string;
}

const COUNTABLE = /^(\$?)(\d+|\d{1,3}(?:,\d{3}){1,3})(%|\+)?$/;

export function countUp(value: string | number): CountUp | null {
  const m = COUNTABLE.exec(String(value).trim());
  if (!m) return null;
  const digits = m[2]!;
  const to = Number(digits.replaceAll(",", ""));
  // A plain number past a billion would overflow a CSS integer counter.
  if (!Number.isSafeInteger(to) || to > 2_000_000_000) return null;
  const groups = digits.includes(",") ? digits.split(",").length : 1;
  return {
    to,
    from: groups === 1 ? 0 : 1000 ** (groups - 1),
    groups,
    prefix: m[1] ?? "",
    suffix: m[3] ?? "",
  };
}

/** The attributes the count-up CSS in global.css reads. */
export function countUpAttrs(c: CountUp): Record<string, string> {
  return {
    "data-count-up": "",
    "data-count-groups": String(c.groups),
    "data-count-prefix": c.prefix,
    "data-count-suffix": c.suffix,
    style: `--count-from: ${c.from}; --count-to: ${c.to}`,
  };
}
