// Browser helpers for the application form, kept free of imports so the page
// script stays small (no zod in the bundle). The allowed seats and each
// course's seats come from the built HTML, which renders them from
// positions.yaml. The draft and invalid-field helpers also serve the
// nomination form. Owner: L19.

/**
 * The seat to preselect from a query string such as "?role=space-peak-connector".
 * Returns null when the parameter is missing, empty, repeated with no known
 * value, or not one of the allowed seats.
 */
export function roleFromSearch(search: string, allowed: readonly string[]): string | null {
  const values = new URLSearchParams(search).getAll("role");
  return values.find((v) => allowed.includes(v)) ?? null;
}

/**
 * Whether a course field belongs to the chosen seat. `roles` is the field's
 * space-separated data-roles attribute. With no seat chosen yet, no course
 * field shows, so nobody fills in a course their seat does not need.
 */
export function courseShownFor(role: string | null, roles: string): boolean {
  if (!role) return false;
  return roles.split(/\s+/).includes(role);
}

// A draft of the form in this tab's sessionStorage, so a rejected submission
// does not lose every answer. The tab's own storage never leaves the browser
// and clears when the tab closes. The page saves it on submit, restores it
// after ?error=, and clears it on a fresh visit and on the thanks page.
const DRAFT_KEY = "cs-apply-draft";

/** Where a form keeps its draft, and the fields a draft never keeps. */
export interface DraftStore {
  key: string;
  skip: ReadonlySet<string>;
}

// Never kept: the honeypot, the speed stamp, the Turnstile token, and the
// consent box, which the applicant ticks again on purpose.
const APPLY_DRAFT: DraftStore = {
  key: DRAFT_KEY,
  skip: new Set(["website", "ts", "cf-turnstile-response", "consent"]),
};

/** The non-empty text fields of a form, minus the ones a draft never keeps. */
export function draftFrom(
  entries: Iterable<[string, FormDataEntryValue]>,
  store: DraftStore = APPLY_DRAFT,
): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (typeof value === "string" && value !== "" && !store.skip.has(name)) draft[name] = value;
  }
  return draft;
}

/** A stored draft, or null when it is missing or not a flat object of strings. */
export function parseDraft(raw: string | null, store: DraftStore = APPLY_DRAFT): Record<string, string> | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft: Record<string, string> = {};
  for (const [name, v] of Object.entries(value)) {
    if (typeof v === "string" && !store.skip.has(name)) draft[name] = v;
  }
  return draft;
}

// Storage can be missing or refuse (private modes, blocked site data). The
// form works without it, so every access fails quietly.
export function readDraft(store: DraftStore = APPLY_DRAFT): Record<string, string> | null {
  try {
    return parseDraft(window.sessionStorage.getItem(store.key), store);
  } catch {
    return null;
  }
}

export function saveDraft(draft: Record<string, string>, store: DraftStore = APPLY_DRAFT): void {
  try {
    window.sessionStorage.setItem(store.key, JSON.stringify(draft));
  } catch {
    // The applicant only loses the convenience.
  }
}

export function clearDraft(store: Pick<DraftStore, "key"> = APPLY_DRAFT): void {
  try {
    window.sessionStorage.removeItem(store.key);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Clears the draft each [data-clear-draft] element names. A thanks page
 * renders its form's draft key there, so its script needs no form module.
 */
export function clearNamedDrafts(root: ParentNode): void {
  for (const el of root.querySelectorAll("[data-clear-draft]")) {
    const key = el.getAttribute("data-clear-draft");
    if (key) clearDraft({ key });
  }
}

/**
 * After a rejection that names fields (?field=a&field=b), marks each named
 * control in the form aria-invalid and returns its label text, in form order.
 * A name that is not one of the form's own visible, labelled controls is
 * ignored (the honeypot included), so the URL can only point at fields a
 * visitor can see.
 */
export function markInvalidFields(form: HTMLFormElement, search: string): string[] {
  const names = new Set(new URLSearchParams(search).getAll("field"));
  const labelFor = new Map([...form.querySelectorAll("label")].map((l) => [l.htmlFor, l.textContent?.trim() ?? ""]));
  const labels: string[] = [];
  // instanceof, not a querySelectorAll type argument: TypeScript 6's DOM types
  // reject HTMLSelectElement there (ApplyForm.astro says the same).
  for (const el of form.querySelectorAll("input[name], select[name], textarea[name]")) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    if (!names.has(el.name) || !el.id || el.type === "hidden" || el.closest("[aria-hidden='true']")) continue;
    const label = labelFor.get(el.id);
    if (!label) continue;
    names.delete(el.name);
    el.setAttribute("aria-invalid", "true");
    labels.push(label);
  }
  return labels;
}
