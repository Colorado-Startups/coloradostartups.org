// The "Where they are" map's island (L3a). CityPanel.astro calls it once.
//
// For each map SVG beside a [data-city-panel], it lays one transparent button
// over each city dot (the circles carry data-city and data-count, from
// lib/leaderboard/charts.ts). The SVG stays one image to assistive tech; the
// buttons sit beside it, so each is a real control with its own name.
//
// - The buttons are one tab stop (a toolbar): arrow keys, Home and End move
//   between cities, largest first, and Tab goes on to the panel's links.
// - Hover and focus show a city; a click or tap also pins it, so the pointer
//   can cross other dots on its way to the list. Escape clears the panel.
// - The status line is a polite live region; the list under it is not, so a
//   screen reader hears "Denver: 40 companies." and not every name.
// - Every target is at least 24 px (CityPanel's CSS), above the dot it covers.

/** The button index an arrow, Home or End key moves to, or undefined for any other key. */
export function nextIndex(current: number, key: string, length: number): number | undefined {
  if (length === 0) return undefined;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % length;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + length) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return undefined;
  }
}

/** "Denver: 40 companies." */
export function cityStatus(city: string, count: number): string {
  return `${city}: ${count} ${count === 1 ? "company" : "companies"}.`;
}

interface Hit {
  city: string;
  count: number;
  circle: SVGCircleElement;
  button: HTMLButtonElement;
}

/** Builds the button layer over one map SVG; returns its buttons in focus order. */
function layer(plot: HTMLElement, panelId: string): Hit[] {
  const svg = plot.querySelector("svg");
  const box = svg?.viewBox.baseVal;
  if (!svg || !box || box.width === 0 || box.height === 0) return [];
  const circles = [...svg.querySelectorAll<SVGCircleElement>("circle[data-city]")];
  const hits = circles
    .map((circle) => ({ circle, city: circle.dataset.city ?? "", count: Number(circle.dataset.count) || 0 }))
    .filter((h) => h.city)
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, "en"));
  const group = document.createElement("div");
  group.setAttribute("role", "toolbar");
  group.setAttribute("aria-label", "Cities on the map");
  const out = hits.map((h, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "city-map__hit";
    button.tabIndex = i === 0 ? 0 : -1;
    button.dataset.city = h.city;
    button.setAttribute("aria-label", `${h.city}, ${h.count} ${h.count === 1 ? "company" : "companies"}`);
    button.setAttribute("aria-controls", panelId);
    button.setAttribute("aria-expanded", "false");
    const x = (h.circle.cx.baseVal.value - box.x) / box.width;
    const y = (h.circle.cy.baseVal.value - box.y) / box.height;
    const d = (2 * h.circle.r.baseVal.value) / box.width;
    button.style.left = `${x * 100}%`;
    button.style.top = `${y * 100}%`;
    button.style.setProperty("--d", `${d * 100}%`);
    // Later buttons draw on top: the smaller dots, listed after the larger ones.
    group.appendChild(button);
    return { ...h, button };
  });
  plot.appendChild(group);
  return out;
}

/** Wires every city map on the page. */
export function initCityMaps(doc: Document = document): void {
  for (const panel of doc.querySelectorAll<HTMLElement>("[data-city-panel]")) {
    const figure = panel.closest("figure");
    const status = panel.querySelector<HTMLElement>("[data-city-status]");
    const list = panel.querySelector<HTMLElement>("[data-city-list]");
    if (!figure || !status || !list) continue;
    const prompt = panel.dataset.prompt ?? "";
    const templates = new Map(
      [...panel.querySelectorAll<HTMLTemplateElement>("template[data-city]")].map((t) => [t.dataset.city ?? "", t]),
    );

    figure.setAttribute("data-city-map", "");
    const maps = [...figure.querySelectorAll<HTMLElement>(".plot")].map((plot) => layer(plot, panel.id));
    let shown: string | undefined;
    let pinned = false;

    const show = (city: string | undefined) => {
      if (city === shown) return;
      shown = city;
      for (const hits of maps) {
        for (const h of hits) {
          const on = h.city === city;
          h.circle.classList.toggle("is-active", on);
          h.button.setAttribute("aria-expanded", String(on));
        }
      }
      const template = city ? templates.get(city) : undefined;
      list.replaceChildren(...(template ? [template.content.cloneNode(true)] : []));
      status.textContent = city && template ? cityStatus(city, template.content.childElementCount) : prompt;
      panel.scrollTop = 0;
    };

    for (const hits of maps) {
      hits.forEach((h, i) => {
        h.button.addEventListener("pointerenter", (e) => {
          if (e.pointerType === "mouse" && !pinned) show(h.city);
        });
        h.button.addEventListener("focus", () => show(h.city));
        h.button.addEventListener("click", () => {
          pinned = true;
          show(h.city);
        });
        h.button.addEventListener("keydown", (e) => {
          const next = nextIndex(i, e.key, hits.length);
          if (next === undefined) return;
          e.preventDefault();
          h.button.tabIndex = -1;
          hits[next]!.button.tabIndex = 0;
          hits[next]!.button.focus();
        });
        // The roving tab stop follows the city last chosen by any means.
        h.button.addEventListener("focus", () => {
          for (const other of hits) other.button.tabIndex = other === h ? 0 : -1;
        });
      });
    }

    // On the document, so Escape also clears a city shown by hover alone.
    doc.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || shown === undefined) return;
      const inPanel = panel.contains(doc.activeElement);
      const back = maps.flat().find((h) => h.city === shown && h.button.offsetParent !== null);
      pinned = false;
      show(undefined);
      if (inPanel) back?.button.focus();
      // Focusing the button shows its city again; Escape means clear.
      if (inPanel) show(undefined);
    });
  }
}
