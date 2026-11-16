// @vitest-environment jsdom
// K1: which keydowns open the Ask dialog. "/" opens it from anywhere, unless
// the visitor is typing in a field or holds Ctrl, Alt or Cmd. Runs against
// the module the header's script uses, so it needs no build.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { initAskDialog } from "../../../src/components/ask/ask-dialog";
import { ASK_KEY_STORE, isTypingTarget, opensAsk, readAskKeyOn } from "../../../src/components/ask/shortcut";

afterEach(() => {
  document.body.innerHTML = "";
});

/** Dispatches a keydown on `target` and returns what opensAsk said. */
function decide(target: EventTarget, init: KeyboardEventInit = {}): boolean {
  let verdict = false;
  const listener = (event: KeyboardEvent) => (verdict = opensAsk(event));
  document.addEventListener("keydown", listener);
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true, composed: true, ...init }));
  document.removeEventListener("keydown", listener);
  return verdict;
}

const make = (html: string) => {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
};

describe("the / shortcut", () => {
  it("opens from the page body, a link or a button", () => {
    expect(decide(document.body)).toBe(true);
    expect(decide(make('<a href="/x/">x</a>'))).toBe(true);
    expect(decide(make("<button>Go</button>"))).toBe(true);
  });

  it("opens with Shift held, which some layouts need to type /", () => {
    expect(decide(document.body, { shiftKey: true })).toBe(true);
  });

  it.each(["input", "textarea", "select"])("leaves / to a visitor typing in a %s", (tag) => {
    expect(decide(make(`<${tag}></${tag}>`))).toBe(false);
  });

  it("leaves / to any kind of input, search included", () => {
    expect(decide(make('<input type="search">'))).toBe(false);
  });

  it.each(['contenteditable=""', 'contenteditable="true"', 'contenteditable="plaintext-only"'])(
    "leaves / to an editable element (%s), and to text inside it",
    (attr) => {
      const editor = make(`<div ${attr}><p><b>bold</b></p></div>`);
      expect(decide(editor)).toBe(false);
      expect(decide(editor.querySelector("b")!)).toBe(false);
    },
  );

  it('opens on an element marked contenteditable="false"', () => {
    expect(decide(make('<div contenteditable="false">x</div>'))).toBe(true);
  });

  it("leaves / to a field inside a shadow root, as in Pagefind's box", () => {
    const host = make("<pagefind-input></pagefind-input>");
    const field = host.attachShadow({ mode: "open" }).appendChild(document.createElement("input"));
    expect(decide(field)).toBe(false);
  });

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
    ["Alt", { altKey: true }],
  ])("leaves / alone with %s held", (_name, mods) => {
    expect(decide(document.body, mods)).toBe(false);
  });

  it("ignores other keys, ? included", () => {
    expect(decide(document.body, { key: "?" })).toBe(false);
    expect(decide(document.body, { key: "k" })).toBe(false);
  });

  it("ignores a / another handler already took, or one typed mid-composition", () => {
    const button = make("<button>x</button>");
    button.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
    expect(decide(button)).toBe(false);
    expect(decide(document.body, { isComposing: true })).toBe(false);
  });

  it("names typing targets directly", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(make("<textarea></textarea>"))).toBe(true);
  });
});

// WCAG 2.1.4: the dialog's checkbox turns "/" off, saved on the device. The
// slot below is the header's AskButton markup, cut to what the script reads.
const SLOT = `
<div data-ask-slot>
  <a href="/ask/" data-ask-link>Search</a>
  <button type="button" data-ask-open hidden>Search <kbd>/</kbd></button>
  <template data-ask-template>
    <dialog aria-label="Search or ask">
      <input name="q" type="search" />
      <input type="checkbox" checked data-ask-key-toggle />
    </dialog>
  </template>
</div>`;

/** An in-memory store, or one that throws on every call, as blocked site data does. */
const memory = (seed: Record<string, string> = {}) => {
  const data = new Map(Object.entries(seed));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};
const blocked = () => {
  throw new DOMException("The operation is insecure.", "SecurityError");
};

describe("turning the / key off", () => {
  let stop = () => {};

  beforeAll(() => {
    // jsdom lacks showModal; this stand-in marks the dialog open.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
  });
  afterEach(() => stop());

  const setUp = (store: () => ReturnType<typeof memory>) => {
    document.body.innerHTML = SLOT;
    const slot = document.querySelector<HTMLElement>("[data-ask-slot]")!;
    stop = initAskDialog(slot, store);
    return slot;
  };
  const pressSlash = () =>
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
  const dialog = () => document.querySelector<HTMLDialogElement>("body > dialog");

  it("is on by default: / opens the dialog and the hint shows", () => {
    const slot = setUp(() => memory());
    expect(slot.dataset.askKey).toBe("on");
    pressSlash();
    expect(dialog()?.open).toBe(true);
    expect(dialog()?.querySelector<HTMLInputElement>("[data-ask-key-toggle]")?.checked).toBe(true);
  });

  it("stays off after a page load: / does nothing, the hint hides, the button still opens", () => {
    const slot = setUp(() => memory({ [ASK_KEY_STORE]: "off" }));
    expect(slot.dataset.askKey).toBe("off");
    expect(slot.querySelector("[data-ask-open]")?.hasAttribute("aria-keyshortcuts")).toBe(false);
    pressSlash();
    expect(dialog()).toBeNull();
    slot.querySelector<HTMLButtonElement>("[data-ask-open]")!.click();
    expect(dialog()?.open).toBe(true);
    expect(dialog()?.querySelector<HTMLInputElement>("[data-ask-key-toggle]")?.checked).toBe(false);
  });

  it("saves the checkbox on the device and stops / at once", () => {
    const store = memory();
    const slot = setUp(() => store);
    slot.querySelector<HTMLButtonElement>("[data-ask-open]")!.click();
    const box = dialog()!.querySelector<HTMLInputElement>("[data-ask-key-toggle]")!;
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    expect(store.data.get(ASK_KEY_STORE)).toBe("off");
    expect(slot.dataset.askKey).toBe("off");
    dialog()!.open = false;
    pressSlash();
    expect(dialog()!.open).toBe(false);
  });

  it("stays on with storage that throws, and the checkbox still works for the page view", () => {
    expect(readAskKeyOn(blocked)).toBe(true);
    const slot = setUp(blocked as never);
    expect(slot.dataset.askKey).toBe("on");
    pressSlash();
    const box = dialog()!.querySelector<HTMLInputElement>("[data-ask-key-toggle]")!;
    box.checked = false;
    expect(() => box.dispatchEvent(new Event("change"))).not.toThrow();
    expect(slot.dataset.askKey).toBe("off");
  });

  it("reads the choice once, before any key", () => {
    const store = memory({ [ASK_KEY_STORE]: "off" });
    const getItem = vi.spyOn(store, "getItem");
    setUp(() => store);
    expect(getItem).toHaveBeenCalledTimes(1);
  });
});
