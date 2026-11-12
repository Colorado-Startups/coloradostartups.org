// L26: the copy buttons on the built /leaderboard/kit/ markup, driven in
// jsdom with a fake clipboard. The button appears only once the script runs,
// copies the snippet byte for byte, and says what happened either way.
import { beforeEach, describe, expect, it } from "vitest";

import { badgeSnippet, KIT_BADGES } from "../../../src/components/kit/badges";
import { COPIED, COPY_FAILED, initCopyButtons } from "../../../src/components/kit/copy";
import { readDist } from "../pages";

const built = new DOMParser().parseFromString(readDist("leaderboard/kit/index.html"), "text/html");
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("initCopyButtons on the kit page", () => {
  beforeEach(() => {
    document.body.innerHTML = built.querySelector("main")!.outerHTML;
  });

  it("shows each button and copies that badge's snippet", async () => {
    const written: string[] = [];
    initCopyButtons(document, { writeText: async (t) => void written.push(t) });
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button[data-copy]")];
    expect(buttons.map((b) => b.hidden)).toEqual([false, false]);

    buttons[1]!.click();
    await settle();
    expect(written).toEqual([badgeSnippet(KIT_BADGES[1]!)]);
    expect(document.querySelector(`[data-copy-status='${buttons[1]!.dataset.copy}']`)?.textContent).toBe(COPIED);
    expect(document.querySelector(`[data-copy-status='${buttons[0]!.dataset.copy}']`)?.textContent).toBe("");
  });

  it("selects the snippet and says how to finish when every copy path is refused", async () => {
    // jsdom has no execCommand("copy"), so the fallback is refused as well.
    initCopyButtons(document, { writeText: () => Promise.reject(new Error("denied")) });
    const button = document.querySelector<HTMLButtonElement>("button[data-copy]")!;
    const field = document.getElementById(button.dataset.copy!) as HTMLTextAreaElement;
    button.click();
    await settle();
    expect(document.querySelector(`[data-copy-status='${button.dataset.copy}']`)?.textContent).toBe(COPY_FAILED);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
  });
});
