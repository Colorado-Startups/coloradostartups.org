// Client behavior for <NewsletterSignup>. Bundled as an external file, because
// the CSP is script-src 'self' with no inline scripts.
//
// 1. Stamps "ts" with the load time; the Worker refuses posts under 3 s old.
// 2. Shows the message for ?error=<code>, only on the form whose return path
//    is this page, so a second form elsewhere on the page stays quiet. Codes
//    outside the known list are ignored, so nothing from the URL reaches a
//    selector.

import { stampLoadTime } from "../forms/form-status";
import { newsletterCopy, type NewsletterErrorCode } from "./copy";

const isKnownCode = (value: string | null): value is NewsletterErrorCode =>
  value !== null && Object.hasOwn(newsletterCopy.errors, value);

export function initNewsletterForms(doc: Document, loc: Pick<Location, "pathname" | "search">): void {
  const error = new URLSearchParams(loc.search).get("error");
  for (const form of doc.querySelectorAll<HTMLFormElement>("form[data-newsletter]")) {
    stampLoadTime(form);

    if (!isKnownCode(error) || form.dataset.returnTo !== loc.pathname) continue;
    const message = form.querySelector<HTMLElement>(`[data-error="${error}"]`);
    if (!message) continue;
    message.hidden = false;
    form.querySelector<HTMLInputElement>('input[name="email"]')?.setAttribute("aria-invalid", "true");
  }
}
