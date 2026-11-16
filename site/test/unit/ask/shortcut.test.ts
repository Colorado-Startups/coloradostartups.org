// @vitest-environment jsdom
// K1: which keydowns open the Ask dialog. "/" opens it from anywhere, unless
// the visitor is typing in a field or holds Ctrl, Alt or Cmd. Runs against
// the module the header's script uses, so it needs no build.
import { afterEach, describe, expect, it } from "vitest";

import { isTypingTarget, opensAsk } from "../../../src/components/ask/shortcut";

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
