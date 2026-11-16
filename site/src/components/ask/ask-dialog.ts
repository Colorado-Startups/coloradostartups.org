// The header's Search button and the Ask dialog (step K1). The page ships a
// plain link to /ask/; this swaps in the <button>, and on the first open
// copies the dialog out of its <template> onto <body>. Kept in a template, the
// dialog's form and fields are not in the page until a visitor asks for them,
// so pages that promise no form (the founders page) still have none. On
// <body> it also escapes the phone menu, which hides the nav it sits in.
import { initAskAi, setAskAiPage } from "../ai/ask-ai";
import { opensAsk } from "./shortcut";

const SITE_SUFFIX = / \| Colorado Startups$/;

export function initAskDialog(root: HTMLElement): void {
  const link = root.querySelector<HTMLAnchorElement>("[data-ask-link]");
  const button = root.querySelector<HTMLButtonElement>("[data-ask-open]");
  const template = root.querySelector<HTMLTemplateElement>("template[data-ask-template]");
  if (!link || !button || !template) return;

  let dialog: HTMLDialogElement | null = null;
  let returnTo: HTMLElement | null = null;

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
  document.addEventListener("keydown", (event) => {
    if (dialog?.open || !opensAsk(event)) return;
    event.preventDefault();
    open();
  });
}
