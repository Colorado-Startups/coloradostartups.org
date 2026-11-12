// The phone menu behind the header's toggle (SiteHeader.astro). The toggle's
// label says what a press will do, and Escape closes the open menu and puts
// focus back on the toggle, so a keyboard user always has a way out.
// test/unit/header/menu-toggle.test.ts covers both.
//
// The Escape listener sits on document, and only while the menu is open. On
// the header alone it missed Escape once focus left the header, as it does in
// Safari, which does not focus a clicked button (#321). A closed menu listens
// to nothing, and an Escape another handler already took is left alone.

export const MENU_LABELS = { closed: "Menu", open: "Close menu" } as const;

export function initSiteNav(header: HTMLElement): void {
  const toggle = header.querySelector<HTMLButtonElement>(".menu-toggle");
  const nav = header.querySelector<HTMLElement>("#site-nav");
  if (!toggle || !nav) return;

  const isOpen = () => toggle.getAttribute("aria-expanded") === "true";
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    setOpen(false);
    toggle.focus();
  };
  const setOpen = (open: boolean) => {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? MENU_LABELS.open : MENU_LABELS.closed;
    nav.dataset.open = String(open);
    if (open) document.addEventListener("keydown", onKeydown);
    else document.removeEventListener("keydown", onKeydown);
  };

  toggle.addEventListener("click", () => setOpen(!isOpen()));
}
