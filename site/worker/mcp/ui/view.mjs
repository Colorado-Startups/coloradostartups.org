// The two MCP Apps cards as pure functions: a tool result in, an HTML string
// out. No imports, no DOM and no network, so test/unit/mcp/ui.test.ts runs them
// in plain Node, and site/scripts/build-mcp-ui.mjs inlines this file into
// each card's one HTML document (it drops the `export` keywords).
//
// Every value from the tool result is escaped before it reaches the markup.
// A link is kept only when it is https; the bridge (bridge.mjs) opens it
// through the host's ui/open-link request.

/** Text made safe for HTML content and double-quoted attributes. */
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The URL when it is a well-formed https URL, else null. */
export function safeUrl(value) {
  if (typeof value !== "string" || !/^https:\/\/[^\s"'<>]+$/.test(value)) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** A path resolved against a page's origin, when that page is https. */
export function onSite(path, base) {
  const from = safeUrl(base);
  if (!from) return null;
  try {
    return safeUrl(new URL(path, from).toString());
  } catch {
    return null;
  }
}

/** An anchor the bridge opens through the host, or plain text without a safe URL. */
export function link(text, url, cls) {
  const href = safeUrl(url);
  const c = cls ? ` class="${cls}"` : "";
  if (!href) return `<span${c}>${esc(text)}</span>`;
  return `<a${c} href="${esc(href)}" data-link="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
}

/**
 * The data a tool result carries: its structuredContent when the server sends
 * one, else the JSON in its first text block (the text every host gets).
 * Null for an error result or text that is not a JSON object.
 */
export function toolData(result) {
  if (!result || typeof result !== "object" || result.isError) return null;
  const sc = result.structuredContent;
  if (sc && typeof sc === "object" && !Array.isArray(sc)) return sc;
  const block = Array.isArray(result.content) ? result.content.find((b) => b && b.type === "text") : null;
  if (!block || typeof block.text !== "string") return null;
  try {
    const data = JSON.parse(block.text);
    return data && typeof data === "object" && !Array.isArray(data) && !data.error ? data : null;
  } catch {
    return null;
  }
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sun, Nov 15" for a value whose first ten characters are a YYYY-MM-DD day. */
export function dayLabel(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "6:30 pm" from the local clock time an event's start carries, or "All day". */
export function timeLabel(event) {
  if (event.allDay) return "All day";
  const m = /T(\d{2}):(\d{2})/.exec(String(event.start ?? ""));
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "am" : "pm"}`;
}

/** A region's display name, from the names the generator read from data/geo/regions.geojson. */
export function regionName(id, names) {
  if (id && names[id]) return names[id];
  return "Elsewhere in Colorado";
}

/** One event as a compact card: day, time, title, place or online, region. */
export function eventCard(event, names, calendar) {
  const where = event.inPerson ? event.location || "In person" : "Online";
  // An event's own page is its https link; without one, the card links the calendar.
  const url = safeUrl(event.url) ?? safeUrl(calendar);
  return [
    `<li class="ev">`,
    `<p class="when"><span class="day">${esc(dayLabel(event.start))}</span> <span class="time">${esc(timeLabel(event))}</span></p>`,
    `<p class="title">${link(event.title, url)}</p>`,
    `<p class="meta"><span>${esc(where)}</span> <span class="tag">${esc(regionName(event.region, names))}</span></p>`,
    `</li>`,
  ].join("");
}

const CREDIT = `<p class="credit">Open data from Colorado Startups, CC BY 4.0</p>`;

/** The this_week card: the week's events, soonest first, or one line and the calendar. */
export function renderWeek(data, names) {
  if (!data || !Array.isArray(data.events)) return `<p class="note">The week's events could not be read.</p>`;
  const calendar = safeUrl(data.calendar);
  const place = data.region ? ` in ${esc(regionName(data.region, names))}` : "";
  const range = data.from && data.to ? `${esc(dayLabel(data.from))} to ${esc(dayLabel(data.to))}` : "";
  const head = `<header><h1>This week${place}</h1>${range ? `<p class="sub">${range}, Mountain Time</p>` : ""}</header>`;
  if (data.events.length === 0) {
    return `${head}<p class="note">No events on the calendar this week. ${link("See the calendar", calendar)}</p>${CREDIT}`;
  }
  const events = [...data.events].sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const more =
    typeof data.moreEvents === "number" && data.moreEvents > 0
      ? `<p class="more">${link(`${data.moreEvents} more on the calendar`, calendar)}</p>`
      : `<p class="more">${link("See the calendar", calendar)}</p>`;
  return `${head}<ul class="cards">${events.map((e) => eventCard(e, names, calendar)).join("")}</ul>${more}${CREDIT}`;
}

/** The region card: name, cities, map, next events and a few companies, with links. */
export function renderRegion(data, names, maps) {
  if (!data || typeof data.id !== "string" || !data.name) return `<p class="note">This region could not be read.</p>`;
  const page = safeUrl(data.url);
  const calendar = onSite("/event-calendar/", page);
  const cities = Array.isArray(data.cities) ? data.cities : [];
  const events = Array.isArray(data.events) ? data.events.slice(0, 5) : [];
  const companies = Array.isArray(data.companies) ? data.companies.slice(0, 5) : [];
  const parts = [
    `<header><h1>${esc(data.name)}</h1>${cities.length ? `<p class="sub">${cities.map(esc).join(" &#183; ")}</p>` : ""}</header>`,
  ];
  // The maps are the generator's own SVG, drawn from data/geo/, never from the tool result.
  if (Object.prototype.hasOwnProperty.call(maps, data.id)) parts.push(`<figure class="map">${maps[data.id]}</figure>`);
  if (data.summary) parts.push(`<p class="summary">${esc(data.summary)}</p>`);
  parts.push(`<h2>Next events</h2>`);
  parts.push(
    events.length
      ? `<ul class="cards">${events.map((e) => eventCard(e, names, calendar)).join("")}</ul>`
      : `<p class="note">No events on the calendar here yet. ${link("See the calendar", calendar)}</p>`,
  );
  if (companies.length) {
    parts.push(`<h2>Leaderboard companies</h2>`);
    const rows = companies.map((c) => {
      const url = onSite(`/leaderboard/#company-${encodeURIComponent(String(c.id ?? ""))}`, page);
      const meta = [c.sector, c.city].filter(Boolean).map(esc).join(" &#183; ");
      return `<li>${link(c.name, url)}${meta ? ` <span class="meta">${meta}</span>` : ""}</li>`;
    });
    parts.push(`<ul class="list">${rows.join("")}</ul>`);
  }
  parts.push(`<p class="more">${link(`Open the ${data.name} page`, page)}</p>`, CREDIT);
  return parts.join("");
}
