// The page side of POST /api/e (worker/routes/e.ts): one anonymous click event
// at a time, and one click listener that sends an event for an element marked
// data-track="<event>". Owner: M1b (engagement plan). A marked submit button
// sends when its form submits, so a submit the browser refuses counts nothing.
//
// It sets and reads no cookie and no storage, builds no id, and sends no event
// on its own (no page view). It sends nothing when the browser sends Global
// Privacy Control or Do Not Track, nothing outside a production build, and
// nothing on any host but the live site, so the e2e suite on 127.0.0.1 and
// preview or staging deploys never post.
// It never throws into the page.
//
// Event names and prop keys come from the one list the Worker checks
// (@cs/shared events.ts). That file is imported by path, not through the
// package index, so the browser bundle carries only the list and no zod.

import { cleanProps, isEventName, type PropValue } from "../../../packages/shared/src/events";

export const TRACK_PATH = "/api/e";
// A CORS-safelisted type, so the beacon needs no preflight. The route parses
// the body as JSON whatever the type says.
export const TRACK_CONTENT_TYPE = "text/plain;charset=UTF-8";

// The only hosts that send. Every other host stays silent: a dev server, the
// e2e test server, a preview or staging deploy (*.workers.dev, *.pages.dev,
// staging.coloradostartups.org), so none of them posts into the live project.
export const LIVE_HOSTS: readonly string[] = ["coloradostartups.org", "www.coloradostartups.org"];

export function isLiveHost(hostname: string): boolean {
  return LIVE_HOSTS.includes(hostname.toLowerCase());
}

// True when the visitor's browser asks not to be tracked, by Global Privacy
// Control or by Do Not Track.
export function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const win = window as Window & { doNotTrack?: string };
  return nav.globalPrivacyControl === true || [nav.doNotTrack, win.doNotTrack, nav.msDoNotTrack].includes("1");
}

/** Whether this page may send events at all. */
export function canSend(): boolean {
  return import.meta.env.PROD === true && isLiveHost(location.hostname) && !optedOut();
}

/**
 * Sends one event. Returns true when it was handed to the browser. A name off
 * the list sends nothing; a prop the event does not list, or a value that is
 * not a short slug, a finite number or a boolean, is dropped.
 */
export function track(name: string, props?: Record<string, PropValue>): boolean {
  try {
    if (!isEventName(name) || !canSend()) return false;
    const body = JSON.stringify({ name, props: cleanProps(name, props) });
    if (typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(TRACK_PATH, new Blob([body], { type: TRACK_CONTENT_TYPE }))) return true;
    }
    void fetch(TRACK_PATH, {
      method: "POST",
      body,
      headers: { "Content-Type": TRACK_CONTENT_TYPE },
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

// An attribute value as a prop: "true" and "false" are booleans, a plain
// decimal number is a number, anything else stays a string (and must still
// pass the slug check).
function attrValue(raw: string): PropValue {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
}

/** The event a click on this target sends, or null. Reads data-track and data-track-<prop>. */
export function eventFor(target: EventTarget | null): { name: string; props: Record<string, PropValue> } | null {
  const el = target instanceof Element ? target.closest("[data-track]") : null;
  const name = el?.getAttribute("data-track") ?? "";
  if (!el || !isEventName(name)) return null;
  const props: Record<string, PropValue> = {};
  for (const attr of el.getAttributeNames()) {
    if (!attr.startsWith("data-track-")) continue;
    props[attr.slice("data-track-".length)] = attrValue(el.getAttribute(attr) ?? "");
  }
  return { name, props: cleanProps(name, props) };
}

/**
 * Whether a mark sits on a form's submit button. Such a mark counts when the
 * form submits, not on the click: the browser may refuse the submit, as it
 * does with an empty required box, and then nothing was used.
 */
function submits(el: Element): boolean {
  return (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) && el.form !== null && el.type === "submit";
}

export function onClick(event: Event): void {
  try {
    const el = event.target instanceof Element ? event.target.closest("[data-track]") : null;
    const found = el && !submits(el) ? eventFor(el) : null;
    if (found) track(found.name, found.props);
  } catch {
    // A broken mark must never break the click.
  }
}

/** Sends the mark of the button that submitted a form. A submit event fires only once the browser accepts the form. */
export function onSubmit(event: Event): void {
  try {
    const by = (event as SubmitEvent).submitter;
    const found = by?.hasAttribute("data-track") ? eventFor(by) : null;
    if (found) track(found.name, found.props);
  } catch {
    // A broken mark must never break the submit.
  }
}

/**
 * Adds the one click listener and the one submit listener. Capture phase, so
 * a handler that stops propagation cannot hide a click or a submit.
 */
export function install(doc: Document = document): void {
  // The same function twice is one listener, so a second call adds nothing.
  doc.addEventListener("click", onClick, { capture: true, passive: true });
  doc.addEventListener("submit", onSubmit, { capture: true, passive: true });
}
