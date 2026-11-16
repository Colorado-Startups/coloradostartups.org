// The header's Search button and the Ask dialog (step K1). The page ships a
// plain link to /ask/; this swaps in the <button>, and on the first open
// copies the dialog out of its <template> onto <body>. Kept in a template, the
// dialog's form and fields are not in the page until a visitor asks for them,
// so pages that promise no form (the founders page) still have none. On
// <body> it also escapes the phone menu, which hides the nav it sits in.
import { initAskAi, setAskAiPage } from "../ai/ask-ai";
import { opensAsk, readAskKeyOn, saveAskKeyOn } from "./shortcut";

const SITE_SUFFIX = / \| Colorado Startups$/;

/** Reading localStorage can itself throw where site data is blocked. */
const deviceStore = () => window.localStorage;

export function initAskDialog(root: HTMLElement, store: () => Pick<Storage, "getItem" | "setItem"> = deviceStore): () => void {
  const link = root.querySelector<HTMLAnchorElement>("[data-ask-link]");
  const button = root.querySelector<HTMLButtonElement>("[data-ask-open]");
  const template = root.querySelector<HTMLTemplateElement>("template[data-ask-template]");
  if (!link || !button || !template) return () => {};

  let dialog: HTMLDialogElement | null = null;
  let returnTo: HTMLElement | null = null;
  // Read before the key listener exists, so a visitor who turned "/" off
  // never sees it open the dialog. data-ask-key="off" hides the "/" hint.
  let keyOn = readAskKeyOn(store);
  const setKeyOn = (on: boolean) => {
    keyOn = on;
    root.dataset.askKey = on ? "on" : "off";
    button.toggleAttribute("aria-keyshortcuts", on);
    if (on) button.setAttribute("aria-keyshortcuts", "/");
  };
  setKeyOn(keyOn);

  const build = (): HTMLDialogElement | null => {
    const made = template.content.firstElementChild?.cloneNode(true);
    if (!(made instanceof HTMLDialogElement)) return null;
    // appendChild, not append: the Workers types give body.append another shape.
    document.body.appendChild(made);
    const ai = made.querySelector<HTMLElement>("[data-ask-ai]");
    if (ai) {
      // The prompt names the page the visitor is on, as the guide pages' row does.
      setAskAiPage(ai, document.title.replace(SITE_SUFFIX, "") || "Colorado Startups", location.pathname);
      initAskAi(ai);
    }
    const keyBox = made.querySelector<HTMLInputElement>("input[data-ask-key-toggle]");
    if (keyBox) {
      keyBox.checked = keyOn;
      keyBox.addEventListener("change", () => {
        setKeyOn(keyBox.checked);
        saveAskKeyOn(store, keyBox.checked);
      });
    }
    // Escape is the dialog's. Kept from document, it would also close the
    // phone menu (site-nav.ts) and move focus to the menu button.
    made.addEventListener("keydown", (event) => {
      if (event.key === "Escape") event.stopPropagation();
    });
    // Browsers return focus to where it was on close; this covers one that
    // leaves it on <body>.
    made.addEventListener("close", () => {
      if (returnTo?.isConnected && (document.activeElement === document.body || !document.activeElement)) {
        returnTo.focus();
      }
      returnTo = null;
    });
    // closedby="any" closes on a click outside; Safari lacks it, so test the
    // pointer against the box there. Press and release must both be outside.
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      const outside = (event: PointerEvent) => {
        const box = made.getBoundingClientRect();
        return (
          event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom
        );
      };
      let pressedOutside = false;
      made.addEventListener("pointerdown", (event) => (pressedOutside = outside(event)));
      made.addEventListener("pointerup", (event) => {
        if (pressedOutside && outside(event)) made.close();
      });
    }
    return made;
  };

  const open = () => {
    dialog ??= build();
    if (!dialog || dialog.open) return;
    returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>("input[name='q']")?.focus();
  };

  link.hidden = true;
  button.hidden = false;
  button.addEventListener("click", open);
  const onKey = (event: KeyboardEvent) => {
    if (!keyOn || dialog?.open || !opensAsk(event)) return;
    event.preventDefault();
    open();
  };
  document.addEventListener("keydown", onKey);
  // Pages never call this; tests do, so no listener outlives its test.
  return () => document.removeEventListener("keydown", onKey);
}
