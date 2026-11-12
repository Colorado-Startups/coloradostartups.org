// The suggest-a-resource form's helper island. Owner: L3. It stamps the load
// time the Worker's speed check reads, and turns the ?error= code the Worker
// sends back into a message. The code is a fixed enum (worker/lib/forms.ts),
// and the message is set with textContent, so nothing from the URL is ever
// rendered as HTML.

import { stampLoadTime } from "../forms/form-status";

export const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Check the name and the link, then send it again.",
  verification: "We could not confirm you are a person. Wait a moment, then send it again.",
  ratelimit: "Too many tries from your connection. Wait a minute, then send it again.",
  delivery: "We could not save your suggestion. Try again in a few minutes.",
  unavailable: "Suggestions are closed for the moment. Try again later.",
};

export function initSuggestForm(form: HTMLFormElement, search: string, now: () => number = Date.now): void {
  stampLoadTime(form, now());

  const code = new URLSearchParams(search).get("error") ?? "";
  const message = ERROR_MESSAGES[code];
  const box = form.querySelector<HTMLElement>("[data-form-error]");
  if (message && box) {
    box.textContent = message;
    box.hidden = false;
  }
}
