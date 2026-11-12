// The status half of the site's forms (card "Shared CSS patterns", #195): the
// load stamp the Worker's speed check reads (worker/lib/forms.ts), and the
// one message that matches the ?error= code the Worker sends back.

// Only querySelectorAll: the Workers types give Element an append() that
// HTMLFormElement cannot match, so a whole ParentNode type refuses a form.
type Root = Pick<ParentNode, "querySelectorAll">;

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
