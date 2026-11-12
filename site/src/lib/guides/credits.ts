// /guides/startup-credits/: cloud, GPU and AI credit programs a founder can
// claim (session S7, decisions 78 to 81). Pure shaping with no Astro imports:
// the page passes in the snapshot text, and test/unit/credits/ runs every
// function in plain Node.
//
// The programs come from data/credits/startup-programs.json, a dated copy of
// the Colorado Startups Compute repo's public export. Every row was read on
// the provider's own page on its checked date. They are not Startup Resources
// records: these programs run nationwide, not in Colorado, so they stay out
// of the directory and out of Resourcus's answers. The snapshot's _README
// says how to refresh it.
//
// A snapshot that fails the schema fails the build. The events snapshot
// degrades to an empty list instead, but a credits table with a wrong or
// missing figure must not ship.
import { z } from "zod";

import { asOf, type AsOf } from "./guides";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HTTPS = /^https:\/\/[^/\s]+\S*$/;

/** The export's eligibility groups, in the order a founder reaches them. */
const EXPORT_BUCKETS = ["no_incorporation", "incorporated", "funded_or_partner"] as const;
type ExportBucket = (typeof EXPORT_BUCKETS)[number];

const COVERS = ["cpu", "gpu", "inference", "other"] as const;
export type Cover = (typeof COVERS)[number];

const TrapsSchema = z.object({
  /** null when the provider's page does not say. */
  card_required: z.boolean().nullable(),
  expiry: z.string().min(1).nullable(),
  /** What happens to usage past the credits. */
  overage: z.enum(["stops", "bills", "unknown"]),
  /** Whether the offer's terms let the provider train on your data; null when they do not say. */
  trains_on_data: z.boolean().nullable(),
  other: z.array(z.string().min(1)),
});

const ProgramSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    program: z.string().min(1),
    provider: z.string().min(1),
    bucket: z.enum(EXPORT_BUCKETS),
    credit_first: z.number().int().positive().nullable(),
    credit_max: z.number().int().positive().nullable(),
    /** True when the number is Colorado Startups' arithmetic, not a figure on the provider's page. */
    credit_first_computed: z.boolean(),
    credit_max_computed: z.boolean(),
    amount_note: z.string().min(1),
    covers: z.array(z.enum(COVERS)).min(1),
    requirements: z.array(z.string().min(1)).min(1),
    term: z.string().min(1).nullable(),
    traps: TrapsSchema,
    link: z.string().regex(HTTPS),
    source: z.string().regex(HTTPS),
    checked: z.string().regex(DATE),
  })
  .refine((p) => p.credit_first === null || p.credit_max === null || p.credit_first <= p.credit_max, {
    message: "credit_first is more than credit_max",
  });

const ExportSchema = z
  .object({
    version: z.literal(1),
    checked: z.string().regex(DATE),
    rows: z.array(ProgramSchema).min(1),
  })
  .refine((e) => new Set(e.rows.map((p) => p.id)).size === e.rows.length, { message: "program ids repeat" })
  .refine((e) => e.rows.every((p) => p.checked <= e.checked), {
    message: "a program was checked after the export date",
  });

export const CreditsSnapshotSchema = z
  .object({
    from: z.object({
      repo: z.string().min(1),
      path: z.string().min(1),
      commit: z.string().regex(/^[0-9a-f]{7,40}$/),
      pr: z.string().nullable().optional(),
    }),
    omit: z.array(z.object({ id: z.string().min(1), why: z.string().min(1) })),
    export: ExportSchema,
  })
  .refine((s) => s.omit.every((o) => s.export.rows.some((p) => p.id === o.id)), {
    message: "an omit id names no row in the export; drop it or fix the id",
  });

export type Program = z.infer<typeof ProgramSchema>;
export type CreditsSnapshot = z.infer<typeof CreditsSnapshotSchema>;

/** The snapshot, parsed. Throws on a bad file, so the build stops. */
export function parseCredits(text: string): CreditsSnapshot {
  return CreditsSnapshotSchema.parse(JSON.parse(text));
}

/** The rows the page shows: every row the snapshot does not omit, in export order. */
export function shownPrograms(s: CreditsSnapshot): Program[] {
  const omitted = new Set(s.omit.map((o) => o.id));
  return s.export.rows.filter((p) => !omitted.has(p.id));
}

export const CREDITS_GUIDE = {
  path: "/guides/startup-credits/",
  title: "Startup credits for founders",
  description:
    "Cloud, GPU and AI credit programs a founder can claim, grouped by what each one asks of you. Amounts come from each provider's own page, and computed totals are labeled.",
} as const;

export interface Bucket {
  key: ExportBucket;
  /** The section's anchor on the page. */
  id: "no-company" | "company" | "funded";
  heading: string;
  /** One line under the "Which group are you in?" heading. */
  short: string;
  intro: string;
}

export const BUCKETS: readonly Bucket[] = [
  {
    key: "no_incorporation",
    id: "no-company",
    heading: "No company needed",
    short: "You have an idea and an account. Claim these today.",
    intro: "These need only an account, and many ask for a card. Use them to test an idea before you form a company.",
  },
  {
    key: "incorporated",
    id: "company",
    heading: "You have a company",
    short: "You formed a company. No outside round needed.",
    intro:
      "These want a real company, and many check its website, its business email or its age. None needs an outside round.",
  },
  {
    key: "funded_or_partner",
    id: "funded",
    heading: "You raised money or joined an accelerator",
    short: "You raised a round, or an accelerator or investor gave you a partner code.",
    intro:
      "These need proof of an equity round, a partner code from an accelerator or investor, or an invitation.",
  },
];

/** Each group with its programs, in export order. A group left empty drops out. */
export function byBucket(programs: readonly Program[]): (Bucket & { programs: Program[] })[] {
  return BUCKETS.map((b) => ({ ...b, programs: programs.filter((p) => p.bucket === b.key) })).filter(
    (b) => b.programs.length > 0,
  );
}

export const COVER_LABELS: Record<Cover, string> = {
  cpu: "CPU",
  gpu: "GPU",
  inference: "AI inference",
  other: "Other services",
};

/** The programs that name a kind of compute. */
export function programsCovering(programs: readonly Program[], cover: Cover): Program[] {
  return programs.filter((p) => p.covers.includes(cover));
}

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** Two amounts in a few words, or null when both are missing. */
export function amountHeadline(p: Pick<Program, "credit_first" | "credit_max">): string | null {
  const { credit_first: first, credit_max: max } = p;
  if (first === null && max === null) return null;
  if (first === null) return `Up to ${usd(max!)}`;
  if (max === null) return `From ${usd(first)}`;
  return first === max ? usd(first) : `From ${usd(first)}, up to ${usd(max)}`;
}

type AmountFields = Pick<
  Program,
  "credit_first" | "credit_max" | "credit_first_computed" | "credit_max_computed" | "amount_note"
>;

/**
 * The amount the page shows, split by who stated it. `stated` holds only
 * numbers on the provider's page, and the page sets it beside "per <source
 * page>". `computed` holds Colorado Startups' arithmetic, labeled as such and
 * never credited to the provider (review of PR #103).
 */
export function amountLine(p: AmountFields): { stated: string; computed: string | null } {
  const ours = amountHeadline({
    credit_first: p.credit_first_computed ? p.credit_first : null,
    credit_max: p.credit_max_computed ? p.credit_max : null,
  });
  const computed = ours === null ? null : `${ours} in total (computed here)`;
  const stated = amountHeadline({
    credit_first: p.credit_first_computed ? null : p.credit_first,
    credit_max: p.credit_max_computed ? null : p.credit_max,
  });
  if (stated !== null) return { stated, computed };
  if (/\bEUR\b|€/.test(p.amount_note)) return { stated: "Stated in EUR; see the note", computed };
  return { stated: computed === null ? "Amount not stated" : "No dollar total on the page; see the note", computed };
}

/** "aws.amazon.com/startups/credits": the source page as a short, readable label. */
export function sourceLabel(url: string): string {
  const u = new URL(url);
  return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
}

/** "Tenki (Tenki Cloud, LLC, ...)" becomes "Tenki": the name a sentence can carry. */
export function shortProvider(provider: string): string {
  return provider.replace(/\s*\(.*\)\s*$/, "");
}

// The figure shapes and attribution cues of the house content gate
// (04_tools/voice_lint.py, plus the cues and nouns in 04_tools/cs_site_rules.json).
// The gate is the one definition; this copy only lets the page attribute
// figures before the gate reads them. If the two drift, the built-HTML gate
// warns, and test/unit/credits/ pins the shapes the export uses today.
const FIGURE_NOUNS = [
  "companies", "firms", "workers", "employees", "jobs", "students", "researchers", "startups", "acres",
  "megawatts", "gigawatts", "patents", "labs", "buildings",
  "founders", "members", "attendees", "events", "investors", "meetups", "rounds",
];
const FIGURE = new RegExp(
  [
    String.raw`[$€£]\s?\d[\d,.]*`,
    String.raw`\d[\d,.]*\s?(?:%|\bpercent\b)`,
    String.raw`\b\d{1,3}(?:,\d{3})+\b`,
    String.raw`\b\d[\d,.]*\s?(?:million|billion|trillion|thousand)\b`,
    String.raw`\b\d[\d,.]*\+?\s(?:[a-z-]+\s)?(?:${FIGURE_NOUNS.join("|")})\b`,
  ].join("|"),
  "i",
);
const CUES = [
  "according to", "per ", "source", "cite", "cites", "cited", "reports", "reported", "says", "said",
  "estimate", "estimates", "estimated", "announced", "association", "study", "survey", "census", "data from",
  "figures from", "goal", "target", "on the order of", "via ", "as of ", "sourced from", "(source",
  // The export labels its own arithmetic "(computed here)": the source is
  // Colorado Startups, so such a sentence never gets the provider's name
  // (decisions 80 and 83).
  "(computed here)",
];

/** True when a sentence states a figure with no source, by the gate's own test. */
export function needsSource(sentence: string): boolean {
  const low = sentence.toLowerCase();
  return FIGURE.test(sentence) && !CUES.some((c) => low.includes(c));
}

/**
 * The text with ", per <provider>" added to each sentence that states a figure
 * and no source. Every row was read on that provider's own page, so the
 * provider is the source.
 */
export function attributed(text: string, provider: string): string {
  const who = shortProvider(provider);
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => {
      if (!needsSource(s)) return s;
      const end = /[.!?]$/.test(s) ? s.slice(-1) : "";
      return `${end ? s.slice(0, -1) : s}, per ${who}${end}`;
    })
    .join(" ");
}

// An opt-out the row's own text names: "opt out" in ElevenLabs' settings,
// Deepgram's mip_opt_out flag.
const OPT_OUT = /opt[-_ ]?out/i;

/** The "Trains on your data" answer, or null when the provider's page does not say. */
export function trainsText(p: Pick<Program, "provider" | "amount_note" | "traps">): string | null {
  const v = p.traps.trains_on_data;
  if (v === null) return null;
  const name = shortProvider(p.provider);
  const who = `per ${name}${name.endsWith("s") ? "'" : "'s"} terms`;
  if (!v) return `No, ${who}.`;
  const optOut = [p.amount_note, ...p.traps.other].some((t) => OPT_OUT.test(t));
  return optOut ? `Yes by default, and you can opt out, ${who}.` : `Yes, ${who}.`;
}

// The "Card" answer for a program: whether signing up needs a credit card, or
// that the provider's page does not say (null).
export function cardText(v: boolean | null): string {
  return v === null ? "The page does not say." : v ? "Required." : "Not required.";
}

export const OVERAGE_TEXT: Record<Program["traps"]["overage"], string> = {
  stops: "Service stops when the credits run out.",
  bills: "Usage past the credits is billed.",
  unknown: "The page does not say.",
};

/** The export date as a reader sees it and as a <time> value. */
export function snapshotDate(s: CreditsSnapshot): AsOf {
  // Noon in Denver, so the label never slips a day across time zones.
  return asOf(new Date(`${s.export.checked}T12:00:00-07:00`));
}

/** The schema.org ItemList for the page: the shown programs, in page order, by official link. */
export function creditsJsonLd(s: CreditsSnapshot, site: URL): Record<string, unknown> {
  const programs = byBucket(shownPrograms(s)).flatMap((b) => b.programs);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: CREDITS_GUIDE.title,
    description: CREDITS_GUIDE.description,
    url: new URL(CREDITS_GUIDE.path, site).toString(),
    numberOfItems: programs.length,
    // Grouped by eligibility: an order of convenience, never a ranking.
    itemListOrder: "https://schema.org/ItemListUnordered",
    itemListElement: programs.map((p, i) => ({ "@type": "ListItem", position: i + 1, name: p.program, url: p.link })),
  };
}
