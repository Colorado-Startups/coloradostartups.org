// Loads a deferred Google Calendar frame (CalendarEmbed.astro with
// `deferred`) the first time its <details> opens. A link to the disclosure's
// heading (#full-calendar) opens it too. Owner: L2a.

/** Sets src from data-src on each deferred frame inside `details`. */
export function loadFrames(details: Element): number {
  let loaded = 0;
  for (const frame of details.querySelectorAll<HTMLIFrameElement>("iframe[data-src]")) {
    const src = frame.dataset.src;
    if (!src || frame.getAttribute("src")) continue;
    frame.setAttribute("src", src);
    loaded++;
  }
  return loaded;
}

/** Wires every deferred frame under `root`: load on open, and open on #full-calendar. */
export function wireDeferredFrames(root: Document): void {
  for (const frame of root.querySelectorAll<HTMLIFrameElement>("iframe[data-src]")) {
    const details = frame.closest("details");
    if (!details) {
      loadFrames(frame.parentElement ?? frame);
      continue;
    }
    if (details.open) loadFrames(details);
    details.addEventListener("toggle", () => {
      if (details.open) loadFrames(details);
    });
    const id = details.dataset.openOn;
    if (id) {
      const openOnHash = () => {
        if (window.location.hash === `#${id}`) details.open = true;
      };
      openOnHash();
      window.addEventListener("hashchange", openOnHash);
    }
  }
}
