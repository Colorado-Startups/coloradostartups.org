// Copy buttons on /leaderboard/kit/. Each button names its textarea in
// data-copy. A button stays hidden until this script runs, so a visitor
// without JavaScript sees only the textarea, which they can select and copy
// by hand. Owner: L26.

export const COPIED = "Copied. Paste it into your site's HTML.";
export const COPY_FAILED = "Your browser blocked the copy. The HTML is selected; copy it from the box.";

/** Writes text to the clipboard; false when there is no clipboard or it refuses. */
export async function copyText(text: string, clipboard: Pick<Clipboard, "writeText"> | undefined): Promise<boolean> {
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The older copy path, for a browser or frame that refuses the async
 * clipboard: copies the current selection. False when the browser refuses
 * this too.
 */
function copySelection(doc: Document): boolean {
  try {
    return doc.execCommand("copy");
  } catch {
    return false;
  }
}

export function initCopyButtons(root: Document, clipboard: Pick<Clipboard, "writeText"> | undefined): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-copy]")) {
    const field = root.querySelector<HTMLTextAreaElement>(`textarea#${CSS.escape(button.dataset.copy ?? "")}`);
    if (!field) continue;
    const status = root.querySelector<HTMLElement>(`[data-copy-status="${button.dataset.copy}"]`);
    // One click in the box selects the whole snippet, ready to copy.
    field.addEventListener("focus", () => field.select());
    button.hidden = false;
    button.addEventListener("click", async () => {
      let ok = await copyText(field.value, clipboard);
      if (!ok) {
        // Leaves the snippet selected either way, so a refused copy is one
        // keystroke from done.
        field.select();
        ok = copySelection(root);
      }
      if (status) status.textContent = ok ? COPIED : COPY_FAILED;
    });
  }
}
