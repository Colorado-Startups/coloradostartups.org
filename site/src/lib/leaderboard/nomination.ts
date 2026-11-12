// The nomination form's field names and its parser. The page renders these
// names and worker/routes/nominate.ts parses them, so the two cannot drift.
// Pure and runtime-agnostic: it unit-tests in plain Node and runs in the Worker.
//
// The form posts the company URL as "company_website", not "website", because
// worker/lib/forms.ts reserves "website" for the honeypot. The parser maps it
// back to NominationSchema's `website` key, with https:// in front when the
// nominator typed none ("acme.com").

import { type Nomination, NominationSchema, withHttps } from "@cs/shared";

import { isColoradoCounty } from "./counties";
import { isSector } from "./sectors";

export const NOMINATION_FIELDS = {
  legalName: "legal_name",
  website: "company_website",
  hqCity: "hq_city",
  hqCounty: "hq_county",
  foundedYear: "founded_year",
  privateIndependentForProfit: "private_independent_for_profit",
  baseYear: "base_year",
  baseYearRevenue: "base_year_revenue_usd",
  currentYearRevenue: "current_year_revenue_usd",
  fteHeadcount: "fte_headcount",
  sector: "sector",
  contactName: "contact_name",
  contactEmail: "contact_email",
  consentToPublish: "consent_to_publish",
  attestation: "attestation",
} as const;

// Where the form lives and where the Worker may send people back to.
export const NOMINATE_PATH = "/leaderboard/nominate/";
export const NOMINATE_THANKS_PATH = "/leaderboard/nominate/thanks/";
export const NOMINATE_RETURN_PATHS = [NOMINATE_PATH, "/leaderboard/"] as const;

const F = NOMINATION_FIELDS;

// HTML pattern attributes. Browsers anchor a pattern and compile it with the v
// flag, which wants "/" escaped inside a class.
//   - WEBSITE_PATTERN checks the shape: an optional http(s)://, a dotted host
//     with no space, slash or colon, then an optional path. A colon outside
//     the scheme fails, so "javascript:..." never passes. It does not check
//     which characters a host may hold, so "%.com" passes here, and the Worker
//     still rejects it and names company_website.
//   - USD_PATTERN accepts only what parseUsd accepts: whole dollars, or
//     dollars and cents, with an optional "$" and commas. parseUsd also takes
//     spaces inside the number; the pattern does not.
export const WEBSITE_PATTERN = "(https?://)?[^\\s\\/.:]+(\\.[^\\s\\/.:]+)+(/\\S*)?";
export const USD_PATTERN = "\\s*\\$?\\s*\\d[\\d,]*(\\.\\d{1,2})?\\s*";

// What a rejected nomination keeps in this tab's sessionStorage (the apply
// form's draft helpers in components/apply/client.ts). Never kept: the
// honeypot, the stamp and the token; the three boxes, which the nominator
// ticks again on purpose; and revenue and headcount, which stay only in D1.
export const NOMINATION_DRAFT = {
  key: "cs-nominate-draft",
  skip: new Set<string>([
    "website",
    "ts",
    "cf-turnstile-response",
    "return_to",
    F.privateIndependentForProfit,
    F.consentToPublish,
    F.attestation,
    F.baseYearRevenue,
    F.currentYearRevenue,
    F.fteHeadcount,
  ]),
} as const;

// The form field behind each NominationSchema key. Only website differs
// (the honeypot owns "website").
const FORM_NAME: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.values(F).map((name) => [name, name])),
  website: F.website,
};

/**
 * Where a rejected nomination goes back to: the form, with one `field`
 * parameter per answer to fix, in form order. Only names from
 * NOMINATION_FIELDS are reflected, so nothing the visitor typed reaches the
 * Location header.
 */
export function pathWithInvalidFields(path: string, fields: readonly string[]): string {
  const names = new Set(fields.map((f) => FORM_NAME[f]).filter(Boolean));
  const query = new URLSearchParams();
  for (const name of Object.values(F)) if (names.has(name)) query.append("field", name);
  const q = query.toString();
  return q ? `${path}?${q}` : path;
}

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.replace(/[\r\n]+/g, " ").trim() : "";
}

// A checked HTML checkbox posts its value ("on" by default); an unchecked one
// posts nothing. Only a present, non-empty value counts as true.
function checked(form: FormData, name: string): boolean {
  return text(form, name).length > 0;
}

// Whole dollars or dollars and cents. Commas, spaces and a leading "$" are
// accepted because people type them; anything else (letters, negatives,
// scientific notation) is NaN and fails validation.
export function parseUsd(raw: string): number {
  const cleaned = raw.replace(/[\s,]/g, "").replace(/^\$/, "");
  return /^\d+(?:\.\d{1,2})?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

function parseWholeNumber(raw: string): number {
  const cleaned = raw.replace(/[\s,]/g, "");
  return /^\d+$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

export type NominationParse = { ok: true; data: Nomination } | { ok: false; fields: string[] };

// Build the NominationSchema input from the posted form, then validate it.
// On failure it returns the names of the failing fields (never their values),
// so a caller can log them without logging what a visitor typed.
export function parseNominationForm(form: FormData): NominationParse {
  const candidate = {
    legal_name: text(form, F.legalName),
    website: withHttps(text(form, F.website)),
    hq_city: text(form, F.hqCity),
    hq_county: text(form, F.hqCounty),
    founded_year: parseWholeNumber(text(form, F.foundedYear)),
    private_independent_for_profit: checked(form, F.privateIndependentForProfit),
    base_year: parseWholeNumber(text(form, F.baseYear)),
    base_year_revenue_usd: parseUsd(text(form, F.baseYearRevenue)),
    current_year_revenue_usd: parseUsd(text(form, F.currentYearRevenue)),
    fte_headcount: parseWholeNumber(text(form, F.fteHeadcount)),
    sector: text(form, F.sector),
    contact_name: text(form, F.contactName),
    contact_email: text(form, F.contactEmail),
    consent_to_publish: checked(form, F.consentToPublish),
    attestation: checked(form, F.attestation),
  };

  const fields: string[] = [];
  const parsed = NominationSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) fields.push(String(issue.path[0] ?? "form"));
  }
  // Checks the shared schema leaves to the Leaderboard: the HQ is a Colorado
  // county, the sector is on the list, and neither year is in the future.
  const thisYear = new Date().getUTCFullYear();
  if (!isColoradoCounty(candidate.hq_county)) fields.push("hq_county");
  if (!isSector(candidate.sector)) fields.push("sector");
  if (parsed.success && candidate.founded_year > thisYear) fields.push("founded_year");
  if (parsed.success && candidate.base_year > thisYear) fields.push("base_year");

  if (!parsed.success || fields.length > 0) return { ok: false, fields: [...new Set(fields)] };
  return { ok: true, data: parsed.data };
}
