// Open positions (decision 44): grouping, labels and the email behind each
// open seat's "Email us about this seat" button. Pure functions over PositionSchema data, so /get-involved/, the Team
// page and L8's region pages build the same card and the same email.
//
// Copy rule: no "paid", "pay", "salary", "stipend", "hiring", "hire" or "job"
// on any position (decisions 44 and 67). Seats with an open `apply` block link
// to the application form instead of the email (L19), and they alone say they
// are volunteer roles, in UNPAID_VOLUNTEER_LINE (decision 67). The other seats
// keep decision 44's ban on "volunteer" until Paul says they are unpaid.
import type { Person, Position, PositionArea } from "@cs/shared";

/** Where every seat email goes until Paul publishes the form. */
export const RAISE_HAND_EMAIL = "info@coloradostartups.org";

/** The order /get-involved/ shows the groups in: community, regions, projects. */
export const AREA_ORDER: readonly PositionArea[] = ["community", "region", "project"];

const AREA_LABELS: Record<PositionArea, string> = {
  community: "Community",
  region: "Regions",
  project: "Projects",
};

const AREA_INTROS: Record<PositionArea, string> = {
  community: "Keep the Slack and the LinkedIn Group useful, and connect founders across Colorado.",
  region: "Connect the founders in your part of Colorado.",
  project: "Help with the shared work that keeps the community useful.",
};

export interface PositionGroup {
  area: PositionArea;
  /** The section id on /get-involved/: community, regions, projects. */
  anchor: string;
  label: string;
  intro: string;
  positions: Position[];
}

/**
 * Groups positions by area in AREA_ORDER, keeping input order inside a group.
 * Sort with comparePositions() from @cs/shared first. Empty groups drop out.
 */
export function groupByArea(positions: readonly Position[]): PositionGroup[] {
  return AREA_ORDER.map((area) => ({
    area,
    anchor: AREA_LABELS[area].toLowerCase(),
    label: AREA_LABELS[area],
    intro: AREA_INTROS[area],
    positions: positions.filter((p) => p.area === area),
  })).filter((g) => g.positions.length > 0);
}

/** The subject line a seat email carries: the seat, by name. */
export function raiseHandSubject(position: Pick<Position, "title">): string {
  return `Raise my hand: ${position.title}`;
}

/**
 * A mailto: link to RAISE_HAND_EMAIL with the seat in the subject and a short
 * prompt in the body. encodeURIComponent, not URLSearchParams: mail clients
 * read "+" literally, so spaces must be %20. Line breaks in the body are CRLF,
 * which encodes as %0D%0A (RFC 6068, section 5).
 */
export function raiseHandHref(position: Pick<Position, "title">): string {
  const subject = encodeURIComponent(raiseHandSubject(position));
  const body = encodeURIComponent(
    [
      "Hi Colorado Startups,",
      "",
      `I would like to help as ${position.title}.`,
      "",
      "Where I am in Colorado:",
      "What I am building or working on:",
      "",
    ].join("\r\n"),
  );
  return `mailto:${RAISE_HAND_EMAIL}?subject=${subject}&body=${body}`;
}

/**
 * The one plain line every seat that takes applications carries, on its card
 * and once on the application form (decision 67). A DOM test checks it on
 * every built page that shows such a seat.
 */
export const UNPAID_VOLUNTEER_LINE = "An unpaid volunteer role.";

/** Where a seat's application form lives (lane L19). The form preselects the seat. */
const APPLY_FORM_PATH = "/get-involved/apply/";

/** True for an open seat whose `apply` block takes applications. */
export function takesApplications(position: Pick<Position, "status" | "apply">): boolean {
  return position.status === "open" && position.apply?.open === true;
}

/** The application form, with this seat preselected. */
export function applyHref(position: Pick<Position, "id">): string {
  return `${APPLY_FORM_PATH}?role=${encodeURIComponent(position.id)}`;
}

/** The person who holds a filled position, or undefined for an open one. */
export function holderOf(position: Position, people: readonly Person[]): Person | undefined {
  if (position.status !== "filled" || !position.holder) return undefined;
  return people.find((p) => p.id === position.holder);
}
