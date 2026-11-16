// The "Where they are" map's island (L3a). CityPanel.astro calls it once.
//
// For each map SVG beside a [data-city-panel], it lays one transparent button
// over each city dot (the circles carry data-city and data-count, from
// lib/leaderboard/charts.ts). The SVG stays one image to assistive tech; the
// buttons sit beside it, so each is a real control with its own name.
//
// - Below 40rem the Front Range dots sit 10 to 20 px apart, too close for
//   24 px targets (review of #84). There the dots' buttons are hidden and a
//   wrapping row of city buttons ("Denver (40)", drawn by CityPanel) under
//   the map does the same job with the same handlers and panel.
// - Each set of buttons is one tab stop (a toolbar): arrow keys, Home and End
//   move between cities, largest first, and Tab goes on to the panel's links.
// - Hover and focus show a city; a click or tap also pins it, so the pointer
//   can cross other dots on its way to the list. Escape clears the panel.
// - The polite live status changes only on focus, click and Escape
//   (writesLive), so a screen reader never hears every dot the pointer
//   crosses. Hover updates an aria-hidden copy that sighted readers see. The
//   list is not live either, so a screen reader hears "Denver: 40 companies."
//   and not every name.

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

/** What a city button says in the phone row: "Denver (40)", as the map labels do. */
export function chipLabel(city: string, count: number): string {
  return `${city} (${count})`;
}

/** How a city came to be shown. */
export type ShowSource = "hover" | "focus" | "click" | "clear";

/** True when a change may reach the live region: never on hover. */
export function writesLive(source: ShowSource): boolean {
  return source !== "hover";
}

interface City {
  city: string;
  count: number;
}

/** The cities one map SVG draws, largest first, ties A to Z. */
function citiesOf(svg: SVGSVGElement): (City & { circle: SVGCircleElement })[] {
  return [...svg.querySelectorAll<SVGCircleElement>("circle[data-city]")]
    .map((circle) => ({ circle, city: circle.dataset.city ?? "", count: Number(circle.dataset.count) || 0 }))
    .filter((c) => c.city)
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, "en"));
}

function cityButton(c: City, panelId: string, className: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.city = c.city;
  button.setAttribute("aria-controls", panelId);
  button.setAttribute("aria-expanded", "false");
  return button;
}

function toolbar(className: string): HTMLDivElement {
  const group = document.createElement("div");
  group.className = className;
  group.setAttribute("role", "toolbar");
  group.setAttribute("aria-label", "Cities on the map");
  return group;
}

/** Builds the button layer over one map SVG; returns its buttons in focus order. */
function layer(plot: HTMLElement, panelId: string): HTMLButtonElement[] {
  const svg = plot.querySelector("svg");
  const box = svg?.viewBox.baseVal;
  if (!svg || !box || box.width === 0 || box.height === 0) return [];
  const group = toolbar("city-map__layer");
  const buttons = citiesOf(svg).map((c) => {
    const button = cityButton(c, panelId, "city-map__hit");
    button.setAttribute("aria-label", `${c.city}, ${c.count} ${c.count === 1 ? "company" : "companies"}`);
    button.style.left = `${((c.circle.cx.baseVal.value - box.x) / box.width) * 100}%`;
    button.style.top = `${((c.circle.cy.baseVal.value - box.y) / box.height) * 100}%`;
    button.style.setProperty("--d", `${((2 * c.circle.r.baseVal.value) / box.width) * 100}%`);
    // Later buttons draw on top: the smaller dots, listed after the larger ones.
    group.appendChild(button);
    return button;
  });
  plot.appendChild(group);
  return buttons;
}

/** The phone row CityPanel draws: one visible, wrapping button per city, largest first. */
function chipRow(figure: HTMLElement): HTMLButtonElement[] {
  return [...figure.querySelectorAll<HTMLButtonElement>("[data-city-chips] button[data-city]")];
}

/** Wires every city map on the page. */
export function initCityMaps(doc: Document = document): void {
  for (const panel of doc.querySelectorAll<HTMLElement>("[data-city-panel]")) {
    const figure = panel.closest("figure");
    const live = panel.querySelector<HTMLElement>("[data-city-status]");
    const visual = panel.querySelector<HTMLElement>("[data-city-visual]");
    const list = panel.querySelector<HTMLElement>("[data-city-list]");
    if (!figure || !live || !visual || !list) continue;
    const prompt = panel.dataset.prompt ?? "";
    const templates = new Map(
      [...panel.querySelectorAll<HTMLTemplateElement>("template[data-city]")].map((t) => [t.dataset.city ?? "", t]),
    );

    figure.setAttribute("data-city-map", "");
    const plots = [...figure.querySelectorAll<HTMLElement>(".plot")];
    const groups = plots.map((plot) => layer(plot, panel.id));
    groups.push(chipRow(figure));
    const buttons = groups.flat();
    const circles = [...figure.querySelectorAll<SVGCircleElement>("circle[data-city]")];
    let shown: string | undefined;
    let pinned = false;

    const show = (city: string | undefined, source: ShowSource) => {
      const template = city ? templates.get(city) : undefined;
      const text = city && template ? cityStatus(city, template.content.childElementCount) : prompt;
      if (city !== shown) {
        shown = city;
        for (const c of circles) c.classList.toggle("is-active", c.dataset.city === city);
        for (const b of buttons) b.setAttribute("aria-expanded", String(b.dataset.city === city));
        list.replaceChildren(...(template ? [template.content.cloneNode(true)] : []));
        visual.textContent = text;
        panel.scrollTop = 0;
      }
      if (writesLive(source) && live.textContent !== text) live.textContent = text;
    };

    for (const group of groups) {
      group.forEach((button, i) => {
        const city = button.dataset.city!;
        button.addEventListener("pointerenter", (e) => {
          if (e.pointerType === "mouse" && !pinned) show(city, "hover");
        });
        button.addEventListener("focus", () => {
          // The roving tab stop follows the city last chosen by any means.
          for (const other of group) other.tabIndex = other === button ? 0 : -1;
          show(city, "focus");
        });
        button.addEventListener("click", () => {
          pinned = true;
          show(city, "click");
        });
        button.addEventListener("keydown", (e) => {
          const next = nextIndex(i, e.key, group.length);
          if (next === undefined) return;
          e.preventDefault();
          group[next]!.focus();
        });
        button.tabIndex = i === 0 ? 0 : -1;
      });
    }

    // On the document, so Escape also clears a city shown by hover alone.
    doc.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || shown === undefined) return;
      const inPanel = panel.contains(doc.activeElement);
      // The visible button for the city: a dot's on a wide screen, a chip's on a phone.
      const back = buttons.find((b) => b.dataset.city === shown && b.offsetParent !== null);
      pinned = false;
      if (inPanel) back?.focus();
      // Focusing the button shows its city again; Escape means clear.
      show(undefined, "clear");
    });
  }
}
