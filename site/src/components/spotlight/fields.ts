// The "Get featured" form (step P3a): field names, limits, the consent
// wording and its version, the example card's values, paths, parser and the
// notice email. SpotlightForm.astro renders these names and
// worker/routes/spotlight.ts parses with them, so the two cannot drift. Pure
// and runtime-agnostic: it unit-tests in plain Node and runs in the Worker.
//
// A founder asks to be featured and agrees, in two required boxes, to be
// shown. Nothing here publishes anything: Paul reads each request and decides
// by hand, and a published spotlight is a reviewed file in data/spotlights/
// (step P3b). 0003_spotlight_requests.sql CHECKs the same rules, and
// test/worker/spotlight.test.ts checks the two agree.
//
// The company website and the LinkedIn link are parsed and stored as text.
// Nothing here or in the route fetches, unfurls or previews them (BRIEF hard
// constraint 12).

import { APPLY_LIMITS, parseHttpsLink, parseLinkedInLink } from "@cs/shared";
import { z } from "zod";

import { cleanLine } from "../apply/fields";

// "website" is the honeypot on every form, so the company's site is
// company_website.
export const SPOTLIGHT_FIELDS = {
  firstName: "first_name",
  lastName: "last_name",
  email: "email",
  role: "role",
  company: "company",
  companyWebsite: "company_website",
  city: "city",
  building: "building",
  linkedin: "linkedin",
  founder: "founder",
  consentShow: "consent_show",
} as const;

export const SPOTLIGHT_ENDPOINT = "/api/spotlight";
export const SPOTLIGHT_PATH = "/get-featured/";
export const SPOTLIGHT_THANKS_PATH = "/get-featured/thanks/";

export const SPOTLIGHT_LIMITS = {
  name: APPLY_LIMITS.name,
  email: APPLY_LIMITS.email,
  role: 80,
  company: 160,
  link: APPLY_LIMITS.link,
  city: 80,
  building: 140,
} as const;

/**
 * The two required boxes, word for word. A request stores
 * SPOTLIGHT_CONSENT_VERSION beside the time it was sent, so the record shows
 * exactly which wording the person agreed to. Change a sentence here and the
 * version must change with it: test/worker/spotlight.test.ts pins the pair.
 */
export const SPOTLIGHT_CONSENT = {
  founder: "I am a founder or cofounder of this company.",
  show: "Colorado Startups may show my name, role, company, company website, city and this line on its website, and my LinkedIn link if I give one. I can ask to be removed at any time.",
} as const;
export const SPOTLIGHT_CONSENT_VERSION = "2026-11-16";

/**
 * The made-up founder the page's example card shows, and the examples the
 * form's hints give. No real person or company: "Example" is in both names.
 */
export const SPOTLIGHT_EXAMPLE = {
  name: "Alex Example",
  role: "Cofounder and CEO",
  company: "Switchback Example Co.",
  city: "Salida",
  building: "Trail maps that update themselves after every storm.",
} as const;

// The browser's check for the website, and the Worker's: https only (the
// waitlist form's pattern). It takes "acme.com" (the Worker adds https://) or
// https://acme.com, and turns away http:// and any other scheme.
export { WAITLIST_WEBSITE_PATTERN as SPOTLIGHT_WEBSITE_PATTERN } from "../founders/waitlist-fields";
// The apply form's LinkedIn pattern: linkedin.com or a subdomain, with a path.
export { LINKEDIN_PATTERN } from "../apply/fields";

/** This tab's draft of the form, kept after a rejection (apply/client.ts helpers). */
export const SPOTLIGHT_DRAFT = {
  key: "cs-get-featured-draft",
  // Never kept: the honeypot, the speed stamp, the Turnstile token, and the
  // two consent boxes, which a person ticks again on purpose.
  skip: new Set<string>([
    "website",
    "ts",
    "cf-turnstile-response",
    SPOTLIGHT_FIELDS.founder,
    SPOTLIGHT_FIELDS.consentShow,
  ]),
};

const httpsLink = z
  .string()
  .max(SPOTLIGHT_LIMITS.link)
  .refine((v) => parseHttpsLink(v) === v, { message: "an https link, normalized" });

const linkedInLink = z
  .string()
  .max(SPOTLIGHT_LIMITS.link)
  .refine((v) => parseLinkedInLink(v) === v, { message: "a LinkedIn link, normalized" });

export const SpotlightRequestSchema = z.object({
  first_name: z.string().min(1).max(SPOTLIGHT_LIMITS.name),
  last_name: z.string().min(1).max(SPOTLIGHT_LIMITS.name),
  email: z.email().max(SPOTLIGHT_LIMITS.email),
  role: z.string().min(1).max(SPOTLIGHT_LIMITS.role),
  company: z.string().min(1).max(SPOTLIGHT_LIMITS.company),
  company_website: httpsLink,
  city: z.string().min(1).max(SPOTLIGHT_LIMITS.city),
  building: z.string().min(1).max(SPOTLIGHT_LIMITS.building),
  linkedin: linkedInLink.nullable(),
  // SPOTLIGHT_CONSENT.founder. No box, no save.
  founder: z.literal(true),
  // SPOTLIGHT_CONSENT.show. No box, no save.
  consent_show: z.literal(true),
});

export type SpotlightRequest = z.infer<typeof SpotlightRequestSchema>;
export type SpotlightParse = { ok: true; data: SpotlightRequest } | { ok: false; fields: string[] };

function raw(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

const F = SPOTLIGHT_FIELDS;

/**
 * Builds the SpotlightRequestSchema input from the posted form, then
 * validates it. On failure it returns the names of the failing fields, never
 * their values, so the route can log them without logging what a person
 * typed.
 */
export function parseSpotlightForm(form: FormData): SpotlightParse {
  const line = (name: string) => cleanLine(raw(form, name));
  const website = line(F.companyWebsite);
  const linkedin = line(F.linkedin);
  const candidate = {
    first_name: line(F.firstName),
    last_name: line(F.lastName),
    email: line(F.email),
    role: line(F.role),
    company: line(F.company),
    // A link typed without https:// is normalized; one that fails the rule
    // stays as typed, so the schema rejects it instead of dropping it.
    company_website: parseHttpsLink(website) ?? website,
    city: line(F.city),
    building: line(F.building),
    linkedin: linkedin ? (parseLinkedInLink(linkedin) ?? linkedin) : null,
    founder: line(F.founder).length > 0,
    consent_show: line(F.consentShow).length > 0,
  };
  const parsed = SpotlightRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => String(issue.path[0] ?? "form"));
    return { ok: false, fields: [...new Set(fields)] };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Where a rejected request goes back to: the form, with one `field`
 * parameter per answer to fix, in form order. Only SPOTLIGHT_FIELDS names are
 * reflected, so nothing the visitor typed reaches the Location header.
 */
export function spotlightPathWithInvalidFields(fields: readonly string[]): string {
  const names = new Set(fields);
  const query = new URLSearchParams();
  for (const name of Object.values(F)) if (names.has(name)) query.append("field", name);
  const q = query.toString();
  return q ? `${SPOTLIGHT_PATH}?${q}` : SPOTLIGHT_PATH;
}

/**
 * The notice to Paul. Like the Slack join notice, it carries the whole
 * request: he decides from it and replies by hand to the email in it (P3a
 * brief, 2026-11-16). The privacy policy says so.
 */
export function spotlightNoticeSubject(r: SpotlightRequest): string {
  return `Spotlight request: ${r.first_name} ${r.last_name}, ${r.company}`;
}

export function spotlightNoticeBody(r: SpotlightRequest, rowId: number | null, consentAt: string): string {
  return [
    "A founder asked to be featured. The request is waiting in D1.",
    "",
    `Name: ${r.first_name} ${r.last_name}`,
    `Email (reply here; never shown): ${r.email}`,
    `Role: ${r.role}`,
    `Company: ${r.company}`,
    `Company website: ${r.company_website}`,
    `City or region: ${r.city}`,
    `What they are building: ${r.building}`,
    `LinkedIn (shown on the card): ${r.linkedin ?? "not given"}`,
    "",
    `They ticked both boxes at ${consentAt} (consent wording ${SPOTLIGHT_CONSENT_VERSION}):`,
    `- ${SPOTLIGHT_CONSENT.founder}`,
    `- ${SPOTLIGHT_CONSENT.show}`,
    "",
    `Row: spotlight_requests.id = ${rowId ?? "unknown"}`,
    "",
    "The site never opened the website or the LinkedIn link. Nothing is published until a spotlight file is merged.",
  ].join("\n");
}
