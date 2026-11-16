// The "Ask your AI" row's behavior (AskAi.astro), in a module so the Ask
// dialog (components/ask/) can run it on its own copy of the row. Owner: A3a.
import { copyText } from "../kit/copy";
import { askAiLinks, COPIED, COPY_FAILED } from "./prompt";

/** Shows the Copy prompt button and wires it to the row's prompt box. */
export function initAskAi(root: HTMLElement): void {
  const button = root.querySelector<HTMLButtonElement>("[data-ask-copy]");
  const field = root.querySelector<HTMLTextAreaElement>("[data-ask-prompt]");
  const details = root.querySelector<HTMLDetailsElement>("[data-ask-details]");
  const status = root.querySelector<HTMLElement>("[data-ask-status]");
  if (!button || !field) return;
  field.addEventListener("focus", () => field.select());
  button.hidden = false;
  button.addEventListener("click", async () => {
    let ok = await copyText(field.value, navigator.clipboard);
    if (!ok) {
      // The older path: show the box, select the prompt and copy the
      // selection. Either way the prompt is one keystroke from copied.
      if (details) details.open = true;
      field.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    if (status) status.textContent = ok ? COPIED : COPY_FAILED;
  });
}

/** Rewrites the row's prompt and its Claude link for another page's subject and path. */
export function setAskAiPage(root: HTMLElement, subject: string, path: string): void {
  const { prompt, claude } = askAiLinks({ subject, path });
  const field = root.querySelector<HTMLTextAreaElement>("[data-ask-prompt]");
  if (field) field.value = prompt;
  root.querySelector<HTMLAnchorElement>("[data-ask-claude]")?.setAttribute("href", claude);
}
