// The header's region slot (YourRegion.astro, plan step W8). The page ships a
// plain "Pick your region" link to /regions/. This swaps in the button that
// opens the chooser or, when this device picked a region, that region's crest
// and name, linking to its page, with a Change button beside them.
//
// The chooser waits in a <template> and joins <body> on first open, as the Ask
// dialog does (ask-dialog.ts). There it also escapes the phone menu, which
// hides the nav the slot sits in. A pick is saved on this device only
// (lib/your-region.ts) and announced to the page, so This week follows it.
// Where the device keeps no site data, a pick still lasts for the page view,
// and the chooser's note says that instead of its promise to keep it.
import {
  clearRegion,
  deviceStore,
  parseRegion,
  readRegion,
  type RegionStore,
  saveRegion,
  YOUR_REGION_EVENT,
} from "../../../lib/your-region";

const PICK = "button[data-region-pick]";

export function initRegionSlot(root: HTMLElement, store: RegionStore | null = deviceStore(window)): void {
  const doc = root.ownerDocument;
  const ids = (root.dataset.regionIds ?? "").split(" ").filter(Boolean);
  const link = root.querySelector<HTMLAnchorElement>("a[data-region-link]");
  const open = root.querySelector<HTMLButtonElement>("button[data-region-open]");
  const mine = root.querySelector<HTMLElement>("[data-region-mine]");
  const page = mine?.querySelector<HTMLAnchorElement>("a[data-region-page]");
  const crest = mine?.querySelector<HTMLElement>("[data-region-crest]");
  const name = mine?.querySelector<HTMLElement>("[data-region-name]");
  const change = mine?.querySelector<HTMLButtonElement>("button[data-region-change]");
  const template = root.querySelector<HTMLTemplateElement>("template[data-region-template]");
  if (!link || !open || !mine || !page || !crest || !name || !change || !template) return;

  /** The chooser's button for a region: it carries the region's page, name and crest. */
  const choice = (id: string | null) =>
    [...template.content.querySelectorAll<HTMLButtonElement>(PICK)].find((b) => b.dataset.regionPick === id) ?? null;

  let current: string | null = null;
  let dialog: HTMLDialogElement | null = null;
  let opener: HTMLElement | null = null;
  /** Whether this device keeps the pick: it has storage, and no save or forget failed. The chooser's note says which. */
  let kept = store !== null;

  /** Shows the picked region, or the Pick your region button when there is none. */
  const show = (id: string | null) => {
    const option = choice(id);
    current = option ? id : null;
    link.hidden = true;
    open.hidden = option !== null;
    mine.hidden = option === null;
    if (!option) return;
    page.href = option.dataset.regionHref ?? "/regions/";
    name.textContent = option.querySelector("[data-region-name]")?.textContent ?? "";
    const img = option.querySelector("img")?.cloneNode(true);
    if (img instanceof HTMLElement) {
      img.setAttribute("sizes", "32px");
      img.setAttribute("width", "32");
      img.setAttribute("height", "32");
      crest.replaceChildren(img);
    }
  };

  const pick = (id: string | null) => {
    // Storage that refuses still leaves the pick on this page view. From
    // then on the chooser's note says so, instead of promising the device keeps it.
    const saved = id === null ? clearRegion(store) : saveRegion(store, id, ids);
    if (!saved) kept = false;
    show(parseRegion(id, ids));
    dialog?.close();
    (current ? page : open).focus();
    doc.dispatchEvent(new CustomEvent(YOUR_REGION_EVENT, { detail: current }));
  };

  const build = (): HTMLDialogElement | null => {
    const made = template.content.firstElementChild?.cloneNode(true);
    if (!(made instanceof HTMLElement) || made.tagName !== "DIALOG") return null;
    const box = made as HTMLDialogElement;
    // appendChild, not append: the Workers types give body.append another shape.
    doc.body.appendChild(box);
    // Escape is the dialog's. Kept from document, it would also close the
    // phone menu (site-nav.ts) and move focus to the menu button.
    box.addEventListener("keydown", (event) => {
      if (event.key === "Escape") event.stopPropagation();
    });
    // closedby="any" closes on a click outside; Safari lacks it. The dialog
    // has no padding of its own, so a click on the dialog itself is a click
    // on the backdrop.
    box.addEventListener("click", (event) => {
      if (event.target === box) box.close();
    });
    // Browsers return focus to where it was on close; this covers one that
    // leaves it on <body>, as Safari does after a click on a button.
    box.addEventListener("close", () => {
      const active = doc.activeElement;
      if (opener?.isConnected && (!active || active === doc.body)) opener.focus();
    });
    for (const button of box.querySelectorAll<HTMLButtonElement>(PICK)) {
      button.addEventListener("click", () => pick(button.dataset.regionPick ?? null));
    }
    box.querySelector("button[data-region-forget]")?.addEventListener("click", () => pick(null));
    return box;
  };

  const openChooser = (from: HTMLElement) => {
    dialog ??= build();
    if (!dialog || dialog.open) return;
    opener = from;
    for (const button of dialog.querySelectorAll<HTMLButtonElement>(PICK)) {
      button.setAttribute("aria-pressed", String(button.dataset.regionPick === current));
    }
    const forget = dialog.querySelector<HTMLElement>("[data-region-forget-row]");
    if (forget) forget.hidden = current === null;
    for (const note of dialog.querySelectorAll<HTMLElement>("[data-region-note]")) {
      note.hidden = (note.dataset.regionNote === "kept") !== kept;
    }
    dialog.showModal();
    (dialog.querySelector<HTMLElement>('[aria-pressed="true"]') ?? dialog.querySelector<HTMLElement>(PICK))?.focus();
  };

  open.addEventListener("click", () => openChooser(open));
  change.addEventListener("click", () => openChooser(change));
  show(readRegion(store, ids));
}
