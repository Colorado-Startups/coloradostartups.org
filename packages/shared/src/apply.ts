// Seat applications (lane L19). Four unpaid volunteer seats (decision 67)
// take applications at /get-involved/apply/?role=<id>. site/worker/routes/apply.ts
// validates with ApplicationSchema, and the page renders the same ids, so the
// two cannot drift. data/team/positions.yaml repeats each seat's courses in its
// `apply` block; site/test/unit/l19/ fails if the two disagree.
//
// Badge and LinkedIn links are stored as text. No Worker ever fetches,
// unfurls or previews one (BRIEF hard constraint 12): parsing is the only
// thing done with them. LINK_HOSTS limits where they may point.

import * as z from "zod";

export const APPLY_ROLE_IDS = [
  "slack-community-lead",
  "photon-mountain-connector",
  "fusion-canyon-connector",
  "space-peak-connector",
] as const;
export type ApplyRoleId = (typeof APPLY_ROLE_IDS)[number];

// Claude Academy courses an applicant completes. The ids are the course slugs
// on academy.claude.com/courses/, read there on 2026-10-18.
export const COURSE_IDS = [
  "claude-101",
  "ai-fluency-framework-foundations",
  "building-effective-human-agent-teams",
  "ai-fluency-for-small-businesses",
] as const;
export type CourseId = (typeof COURSE_IDS)[number];

export const COURSE_TITLES: Readonly<Record<CourseId, string>> = {
  "claude-101": "Claude 101",
  "ai-fluency-framework-foundations": "AI Fluency: Framework and foundations",
  "building-effective-human-agent-teams": "Building effective human-agent teams",
  "ai-fluency-for-small-businesses": "AI Fluency for small businesses",
};

export const ACADEMY_ORIGIN = "https://academy.claude.com";

/** The course's own page on Claude Academy. The site links to it; nothing fetches it. */
export function courseUrl(id: CourseId): string {
  return `${ACADEMY_ORIGIN}/courses/${id}`;
}

// Every applicant takes these two. The Slack seat adds the human-agent teams
// course, and each Connector seat adds the small-business course.
export const CORE_COURSES = ["claude-101", "ai-fluency-framework-foundations"] as const satisfies readonly CourseId[];

export const REQUIRED_COURSES: Readonly<Record<ApplyRoleId, readonly CourseId[]>> = {
  "slack-community-lead": [...CORE_COURSES, "building-effective-human-agent-teams"],
  "photon-mountain-connector": [...CORE_COURSES, "ai-fluency-for-small-businesses"],
  "fusion-canyon-connector": [...CORE_COURSES, "ai-fluency-for-small-businesses"],
  "space-peak-connector": [...CORE_COURSES, "ai-fluency-for-small-businesses"],
};

// Caps applied after trimming. `why` is the one long answer the form asks for.
export const APPLY_LIMITS = {
  name: 120,
  email: 254,
  basedIn: 80,
  link: 300,
  why: 1500,
  anythingElse: 1000,
} as const;

/**
 * A web address as typed, with https:// in front when it has no scheme
 * ("linkedin.com/in/name"). An empty value, or one with any scheme, comes back
 * as it was, so a wrong scheme still fails the caller's own check.
 */
export function withHttps(raw: string): string {
  const value = raw.trim();
  return value === "" || /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
}

export interface WebLinkOptions {
  /** The longest link accepted: the trimmed value, scheme included, and the normalized href. */
  max: number;
  /** Put https:// in front of a link typed with no scheme ("linkedin.com/in/name", #138). */
  addScheme?: boolean;
  /** Accept http: as well as https:. */
  allowHttp?: boolean;
  /** Accept a link with an explicit port. */
  allowPort?: boolean;
  /** Accept whitespace inside the link. URL() percent-encodes it in a path. */
  allowWhitespace?: boolean;
}

/**
 * A web link as pasted or typed, or null. It must parse, use https (or http
 * when allowed), carry no user or password, and have a dotted host. Returns
 * the normalized href, so a stored link is always what URL() produced.
 * Nothing here touches the network. Every option defaults to the strict side.
 */
export function parseWebLink(raw: string, opts: WebLinkOptions): string | null {
  const value = opts.addScheme ? withHttps(raw) : raw.trim();
  if (value.length === 0 || value.length > opts.max) return null;
  if (!opts.allowWhitespace && /\s/.test(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && !(opts.allowHttp && parsed.protocol === "http:")) return null;
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname.includes(".") || parsed.hostname.endsWith(".")) return null;
  if (!opts.allowPort && parsed.port !== "") return null;
  const href = parsed.href;
  return href.length <= opts.max ? href : null;
}

/**
 * An applicant's https link, or null: parseWebLink at its strictest, with
 * https:// added to a link typed without it. No port and no whitespace.
 */
export function parseHttpsLink(raw: string): string | null {
  return parseWebLink(raw, { max: APPLY_LIMITS.link, addScheme: true });
}

/**
 * The only hosts an applicant's links may point at. Paul opens every link by
 * hand, so an open https rule would let anyone send him to any site.
 *
 * - badge: exact hosts only. Claude Academy serves badge verification pages
 *   at academy.claude.com/verify/<code> and /badges/<id>; its FAQ (read
 *   2026-10-18) says each badge has "a public verification link" there.
 *   Older Skilljar certificates are not accepted: no Academy page names their
 *   verification host.
 * - linkedin: the host itself or any subdomain of it (www., regional ones).
 */
export const LINK_HOSTS = {
  badge: ["academy.claude.com"],
  linkedin: ["linkedin.com"],
} as const;

function hostIn(href: string, exact: readonly string[], subdomains: boolean): boolean {
  const host = new URL(href).hostname;
  return exact.some((h) => host === h || (subdomains && host.endsWith(`.${h}`)));
}

/** A badge verification link on a LINK_HOSTS.badge host, normalized, or null. */
export function parseBadgeLink(raw: string): string | null {
  const href = parseHttpsLink(raw);
  if (!href || !hostIn(href, LINK_HOSTS.badge, false)) return null;
  return new URL(href).pathname.length > 1 ? href : null;
}

/** A LinkedIn profile link on linkedin.com or a subdomain, with a path, normalized, or null. */
export function parseLinkedInLink(raw: string): string | null {
  const href = parseHttpsLink(raw);
  if (!href || !hostIn(href, LINK_HOSTS.linkedin, true)) return null;
  return new URL(href).pathname.length > 1 ? href : null;
}

const linkWith = (parse: (raw: string) => string | null, what: string) =>
  z
    .string()
    .max(APPLY_LIMITS.link)
    .refine((v) => parse(v) === v, { message: `${what}, normalized` });
const badgeLink = linkWith(parseBadgeLink, "a Claude Academy verification link");
const linkedInLink = linkWith(parseLinkedInLink, "a LinkedIn link");

export const ApplicationSchema = z
  .object({
    role: z.enum(APPLY_ROLE_IDS),
    name: z.string().min(1).max(APPLY_LIMITS.name),
    email: z.email().max(APPLY_LIMITS.email),
    based_in: z.string().min(1).max(APPLY_LIMITS.basedIn),
    linkedin: linkedInLink.nullable(),
    why: z.string().min(1).max(APPLY_LIMITS.why),
    // One verification link per course the seat requires, keyed by course id.
    badges: z.partialRecord(z.enum(COURSE_IDS), badgeLink),
    anything_else: z.string().max(APPLY_LIMITS.anythingElse).nullable(),
    // The applicant agreed that Colorado Startups contacts them about this seat only.
    consent: z.literal(true),
  })
  .superRefine((a, ctx) => {
    const want = REQUIRED_COURSES[a.role];
    const have = Object.keys(a.badges);
    const exact = have.length === want.length && want.every((id) => typeof a.badges[id] === "string");
    if (!exact) {
      ctx.addIssue({ code: "custom", path: ["badges"], message: `needs exactly ${want.join(", ")}` });
    }
  });
export type Application = z.infer<typeof ApplicationSchema>;
