// The "/" shortcut that opens the Ask dialog from any page (step K1). It
// stays out of the way: a visitor typing in a field, or pressing "/" with
// Ctrl, Alt or Cmd (a browser or system shortcut), keeps the key.
// test/unit/ask/shortcut.test.ts covers every rule.
//
// Shift is allowed on purpose. event.key is the character typed, and on many
// layouts (German, Nordic, Spanish) typing "/" takes Shift. On a US layout
// Shift+/ gives "?", which this never matches.

export const ASK_KEY = "/";

// WCAG 2.1.4 (character key shortcuts): a visitor can turn "/" off with the
// dialog's checkbox. The choice stays on the device. With storage blocked the
// key stays on, and the checkbox still works until the page changes.
export const ASK_KEY_STORE = "cs-ask-key";

type Store = Pick<Storage, "getItem" | "setItem">;

/** True unless this device turned the "/" key off. Never throws. */
export function readAskKeyOn(store: () => Store | null | undefined): boolean {
  try {
    return store()?.getItem(ASK_KEY_STORE) !== "off";
  } catch {
    return true;
  }
}

/** Saves the choice on this device, when storage allows it. Never throws. */
export function saveAskKeyOn(store: () => Store | null | undefined, on: boolean): void {
  try {
    store()?.setItem(ASK_KEY_STORE, on ? "on" : "off");
  } catch {
    // Blocked storage: the choice lasts for this page view only.
  }
}

const EDITABLE = '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

/** True when the element takes typed text: an input, textarea, select or editable element. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  if (target.closest("input, textarea, select")) return true;
  // jsdom has no isContentEditable, so the attribute test backs it up.
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest(EDITABLE) !== null;
}

export type AskKeyEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "isComposing" | "defaultPrevented" | "target"
> & { composedPath?: () => EventTarget[] };

/** True when this keydown should open the Ask dialog. */
export function opensAsk(event: AskKeyEvent): boolean {
  if (event.key !== ASK_KEY) return false;
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  // Inside a shadow root (Pagefind's search box) the event's target is the
  // host; the first entry of the composed path is the real field.
  const origin = event.composedPath?.()[0] ?? event.target;
  return !isTypingTarget(origin) && !isTypingTarget(event.target);
}
