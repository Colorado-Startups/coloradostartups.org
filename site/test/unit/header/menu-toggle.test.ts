// @vitest-environment jsdom
// The phone menu toggle (#136): its label says what a press will do, and
// Escape closes the open menu and returns focus to the toggle, wherever focus
// is (#321). Runs in jsdom against the header's own script module, so it needs
// no build.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSiteNav, MENU_LABELS } from "../../../src/components/ui/site-nav";

const HEADER = `
<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="/">Colorado Startups</a>
    <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
    <nav id="site-nav" data-collapsible="true"><ul><li><a href="/team/">Team</a></li></ul></nav>
  </div>
</header>`;

const header = () => document.querySelector<HTMLElement>(".site-header")!;
const toggle = () => document.querySelector<HTMLButtonElement>(".menu-toggle")!;
const nav = () => document.getElementById("site-nav")!;
const press = (key: string, from: HTMLElement) =>
  from.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

beforeEach(() => {
  document.body.innerHTML = HEADER;
  initSiteNav(header());
});

// An open menu listens on document. Close it, so no listener outlives its test.
afterEach(() => {
  if (toggle().getAttribute("aria-expanded") === "true") toggle().click();
});

describe("phone menu toggle", () => {
  it("opens on a press and relabels itself Close menu", () => {
    toggle().click();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(toggle().textContent).toBe(MENU_LABELS.open);
    expect(nav().dataset.open).toBe("true");
  });

  it("closes on a second press and reads Menu again", () => {
    toggle().click();
    toggle().click();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().textContent).toBe(MENU_LABELS.closed);
    expect(nav().dataset.open).toBe("false");
  });

  it("closes on Escape from inside the menu and puts focus back on the toggle", () => {
    toggle().click();
    const link = nav().querySelector("a")!;
    link.focus();
    press("Escape", link);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().textContent).toBe(MENU_LABELS.closed);
    expect(nav().dataset.open).toBe("false");
    expect(document.activeElement).toBe(toggle());
  });

  // #321: Safari does not focus a clicked button, so after a mouse press the
  // focus sits on body, outside the header. The old header-only listener
  // never heard this Escape.
  it("closes on Escape with focus on the page body, and focuses the toggle", () => {
    toggle().click();
    toggle().blur();
    expect(document.activeElement).toBe(document.body);
    press("Escape", document.body);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().textContent).toBe(MENU_LABELS.closed);
    expect(document.activeElement).toBe(toggle());
  });

  it("stops listening once closed, so a later Escape leaves focus where it is", () => {
    toggle().click();
    press("Escape", document.body);
    const link = nav().querySelector("a")!;
    link.focus();
    press("Escape", link);
    expect(document.activeElement).toBe(link);
  });

  it("leaves an Escape another handler already took", () => {
    toggle().click();
    const link = nav().querySelector("a")!;
    link.addEventListener("keydown", (e) => e.preventDefault());
    press("Escape", link);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("leaves a closed menu and the focus alone on Escape", () => {
    const link = nav().querySelector("a")!;
    link.focus();
    press("Escape", link);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(nav().dataset.open).toBeUndefined();
    expect(document.activeElement).toBe(link);
  });

  it("ignores other keys while open", () => {
    toggle().click();
    press("Enter", toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });
});
