// The seat application form's field names, paths and parser. ApplyForm.astro
// renders these names and worker/routes/apply.ts parses with them, so the two
// cannot drift. Pure and runtime-agnostic: it unit-tests in plain Node and runs
// in the Worker. Owner: L19.
//
// Links (LinkedIn and badges) are parsed and stored as text. Nothing here or in
// the route fetches, unfurls or previews them (BRIEF hard constraint 12).

import {
  type Application,
  APPLY_ROLE_IDS,
  ApplicationSchema,
  type ApplyRoleId,
  type CourseId,
  LINK_HOSTS,
  parseBadgeLink,
  parseLinkedInLink,
  REQUIRED_COURSES,
} from "@cs/shared";

export const APPLY_FIELDS = {
  role: "role",
  name: "name",
  email: "email",
  basedIn: "based_in",
  linkedin: "linkedin",
  why: "why",
  anythingElse: "anything_else",
  consent: "consent",
} as const;

/** The form field for one course's badge link, such as "badge_claude-101". */
export function badgeField(course: CourseId): string {
  return `badge_${course}`;
}

export const APPLY_ENDPOINT = "/api/apply";
export const APPLY_PATH = "/get-involved/apply/";
export const APPLY_THANKS_PATH = "/get-involved/apply/thanks/";

// HTML pattern attributes built from LINK_HOSTS, so the browser's check and
// the Worker's agree. Browsers anchor a pattern and compile it with the v
// flag, which wants "-" and "." escaped. The LinkedIn field is type="text", so
// a profile typed without https:// passes, and parseHttpsLink adds it. The
// form asks for each badge's whole verification link, so those fields stay
// type="url".
const escapeHost = (host: string) => host.replace(/[.-]/g, "\\$&");
export const BADGE_PATTERN = `https://(${LINK_HOSTS.badge.map(escapeHost).join("|")})/.+`;
export const LINKEDIN_PATTERN = `(https://)?([a-z0-9\\-]+\\.)*(${LINK_HOSTS.linkedin.map(escapeHost).join("|")})/.+`;

function isApplyRole(value: unknown): value is ApplyRoleId {
  return typeof value === "string" && (APPLY_ROLE_IDS as readonly string[]).includes(value);
}

/**
 * Where an error sends the applicant back to: the form, with the seat they
 * picked still selected. Only a known seat id is reflected, so nothing the
 * visitor typed reaches the Location header.
 */
export function applyPathFor(role: unknown): string {
  const value = typeof role === "string" ? role.trim() : role;
  return isApplyRole(value) ? `${APPLY_PATH}?role=${value}` : APPLY_PATH;
}

const F = APPLY_FIELDS;

function raw(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

// Single-line fields turn CR and LF into a space, so nothing typed can become
// a header line, then lose every control (Cc) and format (Cf) character: ESC,
// the C1 controls, zero-width characters and bidi overrides that could
// disguise a name when Paul reads it.
export function cleanLine(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim();
}

// Long answers keep their line breaks (as LF) and lose every other control
// and format character, tabs included.
export function cleanLongText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/(?!\n)[\p{Cc}\p{Cf}]/gu, "")
    .trim();
}

const line = (form: FormData, name: string) => cleanLine(raw(form, name));
const longText = (form: FormData, name: string) => cleanLongText(raw(form, name));

// An empty optional link is null. A non-empty one that fails its rule stays as
// typed, so the schema rejects it instead of the parser dropping it quietly.
function optionalLink(form: FormData, name: string): string | null {
  const value = line(form, name);
  if (value.length === 0) return null;
  return parseLinkedInLink(value) ?? value;
}

export type ApplicationParse = { ok: true; data: Application } | { ok: false; fields: string[] };

/**
 * Builds the ApplicationSchema input from the posted form, then validates it.
 * Only the chosen seat's badge fields are read. A badge field for another seat
 * (posted with scripts off, when every course shows) is ignored.
 *
 * On failure it returns the names of the failing fields, never their values,
 * so the route can log them without logging what an applicant typed.
 */
export function parseApplicationForm(form: FormData): ApplicationParse {
  const role = line(form, F.role);
  const badges: Partial<Record<CourseId, string>> = {};
  if (isApplyRole(role)) {
    for (const course of REQUIRED_COURSES[role]) {
      const value = line(form, badgeField(course));
      if (value) badges[course] = parseBadgeLink(value) ?? value;
    }
  }
  const anythingElse = longText(form, F.anythingElse);

  const candidate = {
    role,
    name: line(form, F.name),
    email: line(form, F.email),
    based_in: line(form, F.basedIn),
    linkedin: optionalLink(form, F.linkedin),
    why: longText(form, F.why),
    badges,
    anything_else: anythingElse || null,
    consent: line(form, F.consent).length > 0,
  };

  const parsed = ApplicationSchema.safeParse(candidate);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => String(issue.path[0] ?? "form"));
    return { ok: false, fields: [...new Set(fields)] };
  }
  return { ok: true, data: parsed.data };
}

/**
 * The notice to Paul: the seat and the row id, nothing else. Contact details
 * and answers stay in D1, where the runbook deletes them after a decision; an
 * inbox copy would outlive that.
 */
export function noticeSubject(role: ApplyRoleId): string {
  return `Seat application: ${role}`;
}

export function noticeBody(role: ApplyRoleId, rowId: number | null): string {
  return [
    "A new seat application is waiting in D1.",
    "",
    `Seat: ${role}`,
    `Row: applications.id = ${rowId ?? "unknown"}`,
    "",
    "Read it and record the decision: ops/runbooks/promote-submissions.md, Applications.",
  ].join("\n");
}
