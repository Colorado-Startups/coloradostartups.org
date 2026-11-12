// The privacy page shows a draft notice until Paul approves the policy at
// Gate B (L10 lane file). The switch is the policy file's own frontmatter:
// `status: draft` (the schema default) or `status: approved`, in
// data/legal/privacy.md. Owner: L13.

export type PolicyStatus = "draft" | "approved";

/**
 * True unless the file says "approved". A missing status counts as a draft:
 * could not tell is not the same as approved, and the notice is the safe side.
 */
export function isDraftPolicy(status: PolicyStatus | undefined): boolean {
  return status !== "approved";
}

/**
 * Removes HTML comments from the rendered policy. The file's DRAFT comment
 * is a note to reviewers (it names lane files and the approval step), and
 * Astro's Markdown keeps raw HTML comments, so without this it would ship in
 * the page source.
 */
export function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->\s*/g, "");
}

export const DRAFT_NOTICE = {
  title: "This policy is a draft",
  body: "Colorado Startups is still reviewing this policy, and it can change before the new site opens to the public.",
} as const;

/** "October 8, 2026", in UTC so the build machine's time zone cannot shift the day. */
export function formatUpdated(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
