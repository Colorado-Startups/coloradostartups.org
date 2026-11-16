// The founders forum waitlist form (step F1): field names, stages, paths and
// parser. WaitlistForm.astro renders these names and worker/routes/waitlist.ts
// parses with them, so the two cannot drift. Pure and runtime-agnostic: it
// unit-tests in plain Node and runs in the Worker.
//
// The stage ids come from @cs/shared STAGES, less "support", which names the
// people who back founders, not a company's stage (CanvasFilters.astro drops
// it the same way). 0002_founders_waitlist.sql CHECKs the same ids, and
// test/worker/waitlist.test.ts checks the two lists agree.
//
// The company website is parsed and stored as text. Nothing here or in the
// route fetches, unfurls or previews it (BRIEF hard constraint 12).

import { APPLY_LIMITS, parseHttpsLink, STAGES } from "@cs/shared";
import { z } from "zod";

import { cleanLine } from "../apply/fields";
import { STAGE_LABELS } from "../canvas/labels";

// "website" is the honeypot on every form, so the company's site is
// company_website.
export const WAITLIST_FIELDS = {
  firstName: "first_name",
  lastName: "last_name",
  email: "email",
  company: "company",
  companyWebsite: "company_website",
  stage: "stage",
  founder: "founder",
} as const;

export const WAITLIST_ENDPOINT = "/api/waitlist";
export const WAITLIST_PATH = "/founders/";
/** The form's section id on /founders/. Errors come back to it. */
export const WAITLIST_ANCHOR = "waitlist";
export const WAITLIST_FORM_PATH = `${WAITLIST_PATH}#${WAITLIST_ANCHOR}`;
export const WAITLIST_THANKS_PATH = "/founders/waitlist/thanks/";

export const WAITLIST_LIMITS = {
  name: APPLY_LIMITS.name,
  email: APPLY_LIMITS.email,
  company: 160,
  link: APPLY_LIMITS.link,
} as const;

export const WAITLIST_STAGES = STAGES.filter((s) => s !== "support") as unknown as readonly [
  "idea",
  "launch",
  "growth",
];
export type WaitlistStage = (typeof WAITLIST_STAGES)[number];
export const WAITLIST_STAGE_CHOICES = WAITLIST_STAGES.map((id) => [id, STAGE_LABELS[id]] as const);

// The browser's check for the website, and the Worker's: https only. The
// pattern takes "acme.com" (the Worker adds https://) or https://acme.com,
// and turns away http:// and any other scheme. A colon outside the scheme
// fails, so "javascript:..." never passes.
export const WAITLIST_WEBSITE_PATTERN = "(https://)?[^\\s\\/.:]+(\\.[^\\s\\/.:]+)+(/\\S*)?";

/** This tab's draft of the form, kept after a rejection (apply/client.ts helpers). */
export const WAITLIST_DRAFT = {
  key: "cs-founders-waitlist-draft",
  // Never kept: the honeypot, the speed stamp, the Turnstile token, and the
  // founder box, which a person ticks again on purpose.
  skip: new Set<string>(["website", "ts", "cf-turnstile-response", WAITLIST_FIELDS.founder]),
};

const httpsLink = z
  .string()
  .max(WAITLIST_LIMITS.link)
  .refine((v) => parseHttpsLink(v) === v, { message: "an https link, normalized" });

export const WaitlistEntrySchema = z.object({
  first_name: z.string().min(1).max(WAITLIST_LIMITS.name),
  last_name: z.string().min(1).max(WAITLIST_LIMITS.name),
  // Stored lower case, so one person is one row whatever case they type.
  email: z
    .email()
    .max(WAITLIST_LIMITS.email)
    .refine((v) => v === v.toLowerCase()),
  company: z.string().min(1).max(WAITLIST_LIMITS.company),
  company_website: httpsLink.nullable(),
  stage: z.enum(WAITLIST_STAGES).nullable(),
  // The one required box: "I am a founder or cofounder of a company in Colorado".
  founder: z.literal(true),
});

export type WaitlistEntry = z.infer<typeof WaitlistEntrySchema>;
export type WaitlistParse = { ok: true; data: WaitlistEntry } | { ok: false; fields: string[] };

function raw(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

const F = WAITLIST_FIELDS;

/**
 * Builds the WaitlistEntrySchema input from the posted form, then validates
 * it. On failure it returns the names of the failing fields, never their
 * values, so the route can log them without logging what a person typed.
 */
export function parseWaitlistForm(form: FormData): WaitlistParse {
  const line = (name: string) => cleanLine(raw(form, name));
  const website = line(F.companyWebsite);
  const stage = line(F.stage);
  const candidate = {
    first_name: line(F.firstName),
    last_name: line(F.lastName),
    email: line(F.email).toLowerCase(),
    company: line(F.company),
    // A site typed without https:// is normalized; one that fails the rule
    // (http://, another scheme) stays as typed, so the schema rejects it.
    company_website: website ? (parseHttpsLink(website) ?? website) : null,
    stage: stage || null,
    founder: line(F.founder).length > 0,
  };
  const parsed = WaitlistEntrySchema.safeParse(candidate);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => String(issue.path[0] ?? "form"));
    return { ok: false, fields: [...new Set(fields)] };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Where a rejected entry goes back to: the form, with one `field` parameter
 * per answer to fix, in form order. Only WAITLIST_FIELDS names are reflected,
 * so nothing the visitor typed reaches the Location header.
 */
export function waitlistPathWithInvalidFields(fields: readonly string[]): string {
  const names = new Set(fields);
  const query = new URLSearchParams();
  for (const name of Object.values(F)) if (names.has(name)) query.append("field", name);
  const q = query.toString();
  return q ? `${WAITLIST_PATH}?${q}#${WAITLIST_ANCHOR}` : WAITLIST_FORM_PATH;
}
