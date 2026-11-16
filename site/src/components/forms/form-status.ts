// The status half of the site's forms (card "Shared CSS patterns", #195): the
// load stamp the Worker's speed check reads (worker/lib/forms.ts), the one
// message that matches the ?error= code the Worker sends back, and the
// submit event (step M1c).
//
// The submit event. A posted form gets its answer as a new page: the thanks
// page when the Worker took the post, or the form's own page with ?error=
// when it did not. So the event goes from that page. The form, and the
// thanks page's section, name it in data-submit-event (join_submit or
// newsletter_submit). Its `where` is the form's page as a slug (whereOf), so
// both answers to one form share it. Each answer counts only right after the
// post (cameFrom, cameBack): a reload, a back step or a shared link to the
// thanks page or to ?error= counts nothing.

import { track } from "../../lib/track";
import { whereOf } from "../../lib/track-attrs";

// Only querySelectorAll: the Workers types give Element an append() that
// HTMLFormElement cannot match, so a whole ParentNode type refuses a form.
type Root = Pick<ParentNode, "querySelectorAll">;

/** Sends the submit event `el` names in data-submit-event, for the form on the page at `path`. */
export function trackSubmit(el: Element | null | undefined, path: string, ok: boolean): boolean {
  const name = el?.getAttribute("data-submit-event");
  return name ? track(name, { where: whereOf(path), ok }) : false;
}

/**
 * The form's page when this page is a fresh arrival from it, as a thanks page
 * is right after the Worker's 303: same origin, another page, and neither a
 * reload nor a back or forward step. Null otherwise, so a reload or a shared
 * link counts nothing.
 */
export function cameFrom(referrer: string, here: Pick<Location, "origin" | "href">, navType: string | undefined): string | null {
  if (navType !== undefined && navType !== "navigate") return null;
  try {
    const from = new URL(referrer);
    return from.origin === here.origin && from.href !== here.href ? from.pathname : null;
  } catch {
    return null;
  }
}

function navigationType(): string | undefined {
  try {
    return (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type;
  } catch {
    return undefined;
  }
}

/** On a thanks page: sends its submit event with ok true, right after the post. */
export function trackAccepted(
  root: Pick<ParentNode, "querySelector"> = document,
  referrer: string = document.referrer,
  here: Pick<Location, "origin" | "href"> = location,
  navType: string | undefined = navigationType(),
): boolean {
  const path = cameFrom(referrer, here, navType);
  return path ? trackSubmit(root.querySelector("[data-submit-event]"), path, true) : false;
}

/**
 * Whether this page is a fresh answer to a post from its own form, as the
 * form's page with ?error= is right after the Worker's 303. The guard
 * cameFrom gives a thanks page, with the form's page at both ends: a
 * referrer on this site at this path, and neither a reload nor a back or
 * forward step. False otherwise, so a reload or a shared ?error= link
 * counts nothing.
 */
export function cameBack(referrer: string, here: Pick<Location, "origin" | "pathname">, navType: string | undefined): boolean {
  if (navType !== undefined && navType !== "navigate") return false;
  try {
    const from = new URL(referrer);
    return from.origin === here.origin && from.pathname === here.pathname;
  } catch {
    return false;
  }
}

/** On a form's page with ?error=: sends the form's submit event with ok false, right after the post. */
export function trackRejected(
  form: Element | null | undefined,
  referrer: string = document.referrer,
  here: Pick<Location, "origin" | "pathname"> = location,
  navType: string | undefined = navigationType(),
): boolean {
  return cameBack(referrer, here, navType) ? trackSubmit(form, here.pathname, false) : false;
}

/** Stamps each form's hidden "ts" input under `root` with the load time. */
export function stampLoadTime(root: Root, now: number = Date.now()): void {
  for (const input of root.querySelectorAll<HTMLInputElement>('input[name="ts"]')) {
    input.value = String(now);
  }
}

/**
 * Shows and focuses the [data-error] message whose code is `code`, and
 * returns it. No code, or one no message carries, shows nothing. The code is
 * compared as a string, never built into a selector. `prepare` may fill in
 * the message's text before it shows.
 */
export function showErrorMessage(
  root: Root,
  code: string | null,
  prepare?: (message: HTMLElement) => void,
): HTMLElement | null {
  if (!code) return null;
  const message = [...root.querySelectorAll<HTMLElement>("[data-error]")].find((el) => el.dataset.error === code);
  if (!message) return null;
  prepare?.(message);
  message.hidden = false;
  message.tabIndex = -1;
  message.focus();
  return message;
}
