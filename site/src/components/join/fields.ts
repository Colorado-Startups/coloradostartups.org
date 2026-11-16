// The Slack join request form: field names, choices, paths, parser and the
// notice email. SlackJoinForm.astro renders these names and
// worker/routes/join.ts parses with them, so the two cannot drift. Pure and
// runtime-agnostic: it unit-tests in plain Node and runs in the Worker.
//
// The choices match the Google Form Paul used before (read by the
// orchestrator on 2026-11-16). Each choice has a short id, which the form
// posts and D1 stores; 0500_slack_join_requests.sql CHECKs the same ids, and
// test/worker/join.test.ts checks the two lists agree.
//
// The LinkedIn link is parsed and stored as text. Nothing here or in the route
// fetches, unfurls or previews it (BRIEF hard constraint 12).

import { APPLY_LIMITS, parseLinkedInLink } from "@cs/shared";
import { z } from "zod";

import { cleanLine } from "../apply/fields";

export const JOIN_FIELDS = {
  firstName: "first_name",
  lastName: "last_name",
  email: "email",
  linkedin: "linkedin",
  based: "based",
  city: "city",
  describes: "describes",
  heard: "heard",
  newsletter: "newsletter",
} as const;

export const JOIN_ENDPOINT = "/api/join";
export const JOIN_PATH = "/join/slack/";
export const JOIN_THANKS_PATH = "/join/slack/thanks/";

export const JOIN_LIMITS = {
  name: APPLY_LIMITS.name,
  email: APPLY_LIMITS.email,
  link: APPLY_LIMITS.link,
  city: 80,
} as const;

/** Where are you based? `colorado` makes the city required. */
export const BASED_CHOICES = [
  ["colorado", "Colorado"],
  ["connected", "Outside Colorado, but connected to the Colorado ecosystem"],
  ["other", "Other"],
] as const;

/** What best describes you? */
export const DESCRIBES_CHOICES = [
  ["founder", "Founder building a company in Colorado"],
  ["operator", "Startup operator or employee at a Colorado company"],
  ["investor-active", "Investor actively investing in Colorado"],
  ["investor-interested", "Investor interested in Colorado companies"],
  ["service-provider", "Service provider supporting Colorado startups"],
  ["supporter", "Ecosystem supporter or community builder"],
  ["student", "Student or aspiring entrepreneur"],
  ["other", "Other"],
] as const;

/** How did you hear about Colorado Startups? Optional. */
export const HEARD_CHOICES = [
  ["referral", "Word of mouth or referral"],
  ["linkedin", "LinkedIn"],
  ["event", "Event"],
  ["search", "Search"],
  ["other", "Other"],
] as const;

type Ids<T extends readonly (readonly [string, string])[]> = T[number][0];
export type BasedId = Ids<typeof BASED_CHOICES>;
export type DescribesId = Ids<typeof DESCRIBES_CHOICES>;
export type HeardId = Ids<typeof HEARD_CHOICES>;

const ids = <T extends readonly (readonly [string, string])[]>(choices: T) =>
  choices.map(([id]) => id) as unknown as [Ids<T>, ...Ids<T>[]];
const labelOf = (choices: readonly (readonly [string, string])[], id: string | null) =>
  choices.find(([c]) => c === id)?.[1] ?? "not given";

// The browser's check and the Worker's agree: the apply form's LinkedIn
// pattern (linkedin.com or a subdomain, https:// optional, with a path).
export { LINKEDIN_PATTERN } from "../apply/fields";

/** This tab's draft of the form, kept after a rejection (apply/client.ts helpers). */
export const JOIN_DRAFT = {
  key: "cs-join-slack-draft",
  // Never kept: the honeypot, the speed stamp, the Turnstile token, and the
  // newsletter box, which a person ticks again on purpose.
  skip: new Set<string>(["website", "ts", "cf-turnstile-response", JOIN_FIELDS.newsletter]),
};

const linkedInLink = z
  .string()
  .max(JOIN_LIMITS.link)
  .refine((v) => parseLinkedInLink(v) === v, { message: "a LinkedIn link, normalized" });

export const JoinRequestSchema = z
  .object({
    first_name: z.string().min(1).max(JOIN_LIMITS.name),
    last_name: z.string().min(1).max(JOIN_LIMITS.name),
    email: z.email().max(JOIN_LIMITS.email),
    linkedin: linkedInLink,
    based: z.enum(ids(BASED_CHOICES)),
    city: z.string().max(JOIN_LIMITS.city).nullable(),
    describes: z.enum(ids(DESCRIBES_CHOICES)),
    heard: z.enum(ids(HEARD_CHOICES)).nullable(),
    newsletter: z.boolean(),
  })
  .refine((r) => r.based !== "colorado" || (r.city !== null && r.city.length > 0), {
    path: ["city"],
    message: "a city or region, for someone based in Colorado",
  });

export type JoinRequest = z.infer<typeof JoinRequestSchema>;
export type JoinParse = { ok: true; data: JoinRequest } | { ok: false; fields: string[] };

function raw(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

const F = JOIN_FIELDS;

/**
 * Builds the JoinRequestSchema input from the posted form, then validates it.
 * On failure it returns the names of the failing fields, never their values,
 * so the route can log them without logging what a person typed.
 */
export function parseJoinForm(form: FormData): JoinParse {
  const line = (name: string) => cleanLine(raw(form, name));
  const linkedin = line(F.linkedin);
  const city = line(F.city);
  const heard = line(F.heard);
  const candidate = {
    first_name: line(F.firstName),
    last_name: line(F.lastName),
    email: line(F.email),
    // A link typed without https:// is normalized; one that fails the rule
    // stays as typed, so the schema rejects it instead of dropping it.
    linkedin: parseLinkedInLink(linkedin) ?? linkedin,
    based: line(F.based),
    city: city || null,
    describes: line(F.describes),
    heard: heard || null,
    newsletter: line(F.newsletter).length > 0,
  };
  const parsed = JoinRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => String(issue.path[0] ?? "form"));
    return { ok: false, fields: [...new Set(fields)] };
  }
  // A city typed by someone outside Colorado is kept: it still helps Paul.
  return { ok: true, data: parsed.data };
}

/**
 * Where a rejected request goes back to: the form, with one `field`
 * parameter per answer to fix, in form order. Only JOIN_FIELDS names are
 * reflected, so nothing the visitor typed reaches the Location header.
 */
export function joinPathWithInvalidFields(fields: readonly string[]): string {
  const names = new Set(fields);
  const query = new URLSearchParams();
  for (const name of Object.values(F)) if (names.has(name)) query.append("field", name);
  const q = query.toString();
  return q ? `${JOIN_PATH}?${q}` : JOIN_PATH;
}

/**
 * The notice to Paul. Unlike the other forms' notices, it carries the whole
 * request: he decides from it and sends the Slack invite to the email in it
 * (P5a brief, 2026-11-16). The privacy policy says so.
 */
export function joinNoticeSubject(r: JoinRequest): string {
  return `Slack join request: ${r.first_name} ${r.last_name}`;
}

export function joinNoticeBody(r: JoinRequest, rowId: number | null): string {
  return [
    "A new request to join the Colorado Startups Slack is waiting in D1.",
    "",
    `Name: ${r.first_name} ${r.last_name}`,
    `Email (the invite goes here): ${r.email}`,
    `LinkedIn: ${r.linkedin}`,
    `Based: ${labelOf(BASED_CHOICES, r.based)}`,
    `City or region: ${r.city ?? "not given"}`,
    `Describes them: ${labelOf(DESCRIBES_CHOICES, r.describes)}`,
    `Heard about us: ${labelOf(HEARD_CHOICES, r.heard)}`,
    `Newsletter: ${r.newsletter ? "yes, sign them up for Startupers" : "no"}`,
    `Row: slack_join_requests.id = ${rowId ?? "unknown"}`,
    "",
    "The site never opened the LinkedIn link. Open it yourself to check, then send the invite from Slack.",
  ].join("\n");
}
