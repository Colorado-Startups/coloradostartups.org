// M1c over the built site (run `npm run build` first; test:content does):
// every engagement control carries the click mark the one listener reads
// (src/lib/track.ts), and every mark is one the event list allows
// (packages/shared/src/events.ts). Removing a mark from a required control
// fails here, and so does a mark the Worker would refuse or drop.
//
// The marks: data-track="<event>" and one data-track-<prop> per prop, on the
// control itself (a link, a button or a door's summary), never on a box
// around it, where it would count every click inside. A posted form, and its
// thanks page, name their submit event in data-submit-event instead
// (form-status.ts), since a click on a form is not a submit.
import { EVENT_PROPS, isEventName, PROP_TOKEN, REGION_IDS, WAYS_IN } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { shortSlug } from "../../src/lib/track-attrs";
import { contentPages, readDist } from "./pages";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const pages = contentPages().map((p) => ({ route: p.route, doc: parse(p.html) }));
const page = (route: string) => {
  const found = pages.find((p) => p.route === route);
  if (!found) throw new Error(`no built page at ${route}`);
  return found.doc;
};

/** Matches in the page and inside its <template>s (the Ask dialog ships in one). */
function all(doc: Document | Element, selector: string): Element[] {
  const inTemplates = [...doc.querySelectorAll("template")].flatMap((t) => [
    ...(t as HTMLTemplateElement).content.querySelectorAll(selector),
  ]);
  return [...doc.querySelectorAll(selector), ...inTemplates];
}

/** An element's mark as { event, ...props }, or null. */
function mark(el: Element | null | undefined): Record<string, string> | null {
  const event = el?.getAttribute("data-track");
  if (!el || !event) return null;
  const out: Record<string, string> = { event };
  for (const attr of el.getAttributeNames()) {
    if (attr.startsWith("data-track-")) out[attr.slice("data-track-".length)] = el.getAttribute(attr) ?? "";
  }
  return out;
}

const describe1 = (el: Element) => el.outerHTML.slice(0, 120);
const CONTROLS = new Set(["A", "BUTTON", "SUMMARY"]);

describe("every click mark on every built page", () => {
  it("finds marks on the built pages", () => {
    expect(pages.length).toBeGreaterThan(10);
    expect(pages.filter((p) => all(p.doc, "[data-track]").length > 0).length).toBeGreaterThan(10);
  });

  it("names an event on the list, with only the props it lists, each a short slug", () => {
    for (const { route, doc } of pages) {
      for (const el of all(doc, "[data-track]")) {
        const m = mark(el)!;
        expect(isEventName(m.event), `${route}: ${describe1(el)}`).toBe(true);
        const listed: readonly string[] = EVENT_PROPS[m.event as keyof typeof EVENT_PROPS];
        for (const [key, value] of Object.entries(m)) {
          if (key === "event") continue;
          expect(listed, `${route}: ${m.event} carries "${key}"`).toContain(key);
          expect(value, `${route}: ${m.event} ${key}`).toMatch(PROP_TOKEN);
        }
        expect(m.where, `${route}: ${describe1(el)} has no where`).toBeTruthy();
      }
    }
  });

  it("sits on the control itself, never on a box around controls or inside another mark", () => {
    for (const { route, doc } of pages) {
      for (const el of all(doc, "[data-track]")) {
        expect(CONTROLS.has(el.tagName), `${route}: ${describe1(el)}`).toBe(true);
        expect(el.parentElement?.closest("[data-track]") ?? null, `${route}: ${describe1(el)}`).toBeNull();
      }
    }
  });

  it("leaves no data-track-<prop> without its data-track", () => {
    for (const { route, doc } of pages) {
      const stray = all(doc, "*").filter(
        (el) => !el.hasAttribute("data-track") && el.getAttributeNames().some((a) => a.startsWith("data-track-")),
      );
      expect(stray.map(describe1), route).toEqual([]);
    }
  });

  it("names only a submit event that carries ok in data-submit-event", () => {
    for (const { route, doc } of pages) {
      for (const el of all(doc, "[data-submit-event]")) {
        expect(["join_submit", "newsletter_submit"], `${route}: ${describe1(el)}`).toContain(el.getAttribute("data-submit-event"));
      }
    }
  });
});

// The controls that must carry a mark. Each row: the page, a selector for the
// control, and the mark it carries. A missing control fails too.
type Need = { route: string; selector: string; want: Record<string, string> };
const NEEDS: Need[] = [
  { route: "/", selector: `.hero a.btn[href="${WAYS_IN.slack}"]`, want: { event: "join_click", where: "home-hero" } },
  {
    route: "/",
    selector: `.hero a.btn[href="${WAYS_IN["linkedin-group"]}"]`,
    want: { event: "join_click", where: "home-hero-linkedin" },
  },
  { route: "/", selector: `.this-week a[data-link="slack"]`, want: { event: "join_click", where: "home-week" } },
  {
    route: "/",
    selector: `.this-week a[data-link="linkedin-group"]`,
    want: { event: "join_click", where: "home-week-linkedin" },
  },
  { route: "/", selector: `.ask__form button[type="submit"]`, want: { event: "ask_used", where: "home-ask", kind: "search" } },
  { route: "/", selector: `.ask a[href="/ask/"]`, want: { event: "ask_used", where: "home-ask", kind: "resourcus" } },
  {
    route: "/",
    selector: `.ask a[href="/connect/"]`,
    want: { event: "connect_click", where: "home-ask", target: "connect-page" },
  },
  { route: "/connect/", selector: `button[data-copy="mcp-url"]`, want: { event: "connect_copy", where: "connect", target: "mcp-url" } },
  {
    route: "/connect/",
    selector: `button[data-copy="mcp-url-any"]`,
    want: { event: "connect_copy", where: "connect-any", target: "mcp-url" },
  },
  {
    route: "/connect/",
    selector: `button[data-copy="cmd-claude-code"]`,
    want: { event: "connect_copy", where: "connect", target: "claude-code" },
  },
  {
    route: "/connect/",
    selector: `button[data-copy="plugin-claude-code"]`,
    want: { event: "connect_copy", where: "connect", target: "claude-code-plugin" },
  },
  { route: "/connect/", selector: `button[data-copy="cmd-opencode"]`, want: { event: "connect_copy", where: "connect", target: "opencode" } },
  {
    route: "/connect/",
    selector: `button[data-copy="cfg-opencode"]`,
    want: { event: "connect_copy", where: "connect", target: "opencode-config" },
  },
  {
    route: "/connect/",
    selector: `[data-client="claude"] a[href$=".zip"]`,
    want: { event: "connect_click", where: "connect", target: "claude-skill" },
  },
  {
    route: "/ask/",
    selector: `#connect a[href="/connect/"]`,
    want: { event: "connect_click", where: "ask", target: "connect-page" },
  },
  {
    route: "/event-calendar/",
    selector: "a[data-subscribe-feed]",
    want: { event: "event_out", where: "event-calendar-list", source: "calendar-feed" },
  },
  { route: "/links/", selector: `[data-slack-entry] a[href="${WAYS_IN.slack}"]`, want: { event: "join_click", where: "links" } },
  { route: "/contact/", selector: `.doors a[href="${WAYS_IN.slack}"]`, want: { event: "join_click", where: "contact" } },
  { route: "/community/", selector: `[data-channel="slack"] a.btn`, want: { event: "join_click", where: "community" } },
  {
    route: "/community/",
    selector: `[data-channel="linkedin-group"] a.btn`,
    want: { event: "join_click", where: "community-linkedin" },
  },
  ...REGION_IDS.flatMap((id): Need[] => [
    {
      route: `/regions/${id}/`,
      selector: `a.btn[aria-describedby="slack-note-top"]`,
      want: { event: "join_click", where: `regions-${id}-hero` },
    },
    {
      route: `/regions/${id}/`,
      selector: `a.btn[aria-describedby="slack-note"]`,
      want: { event: "join_click", where: `regions-${id}-meet` },
    },
    {
      route: `/regions/${id}/`,
      selector: `.this-week a[data-link="slack"]`,
      want: { event: "join_click", where: `regions-${id}-week` },
    },
    {
      route: "/",
      selector: `.colorado-map__hit--zone[data-zone="${id}"]`,
      want: { event: "map_region_open", where: "home-map", region: id },
    },
    {
      route: "/",
      selector: `tr[data-zone-row="${id}"] a.region-link`,
      want: { event: "map_region_open", where: "home-map-list", region: id },
    },
  ]),
];

describe("the required controls", () => {
  it.each(NEEDS.map((n) => [`${n.route} ${n.selector}`, n] as const))("%s carries its mark", (_label, need) => {
    const found = all(page(need.route), need.selector);
    expect(found.length, `${need.route} has no ${need.selector}`).toBeGreaterThan(0);
    for (const el of found) expect(mark(el), describe1(el)).toEqual(need.want);
  });

  it("marks the header's and the footer's joins on every page", () => {
    for (const { route, doc } of pages) {
      expect(mark(doc.querySelector("header a.cta")), route).toEqual({ event: "join_click", where: "header" });
      const footer = doc.querySelector("footer");
      expect(mark(footer?.querySelector(`a[href="${WAYS_IN.slack}"]`)), route).toEqual({ event: "join_click", where: "footer" });
      expect(mark(footer?.querySelector(`a[href="${WAYS_IN["linkedin-group"]}"]`)), route).toEqual({
        event: "join_click",
        where: "footer-linkedin",
      });
    }
  });

  // One follow-up: /founders/ is open in another PR (#121), so its own Slack
  // button waits for it. Its header and footer joins are marked.
  const FOLLOW_UPS = [{ route: "/founders/", describedBy: "slack-form-note-top" }];

  it("marks every link to the Slack or the LinkedIn Group as join_click", () => {
    for (const { route, doc } of pages) {
      const joins = all(doc, `a[href="${WAYS_IN.slack}"], a[href="${WAYS_IN["linkedin-group"]}"]`).filter(
        (el) => !FOLLOW_UPS.some((f) => f.route === route && el.getAttribute("aria-describedby") === f.describedBy),
      );
      for (const el of joins) expect(mark(el)?.event, `${route}: ${describe1(el)}`).toBe("join_click");
    }
  });

  it("marks each door on home as door_pick with its kind, and its Join the Slack link", () => {
    const doors = all(page("/"), "details.doorway");
    expect(doors.length).toBeGreaterThan(0);
    for (const door of doors) {
      const kind = door.getAttribute("data-kind")!;
      expect(mark(door.querySelector("summary")), kind).toEqual({ event: "door_pick", where: "home-doors", door: kind });
      expect(mark(door.querySelector("a[data-join]")), kind).toEqual({ event: "join_click", where: "home-doors" });
    }
  });

  it("marks each door on /community/ as door_pick", () => {
    const summaries = all(page("/community/"), "details.door > summary");
    expect(summaries.length).toBeGreaterThan(0);
    for (const s of summaries) expect(mark(s)?.event, describe1(s)).toBe("door_pick");
  });

  it("marks the Ask dialog's search, its Resourcus link, its copy and its Claude link", () => {
    const doc = page("/");
    const [dialog] = all(doc, "dialog.ask-dialog");
    expect(dialog).toBeTruthy();
    expect(mark(dialog!.querySelector(".ask-dialog__search button[type='submit']"))).toEqual({
      event: "ask_used",
      where: "ask-dialog",
      kind: "search",
    });
    expect(mark(dialog!.querySelector(".ask-dialog__resourcus a"))).toEqual({ event: "ask_used", where: "ask-dialog", kind: "resourcus" });
    expect(mark(dialog!.querySelector("[data-ask-copy]"))).toEqual({ event: "ask_used", where: "ask-dialog", kind: "copy" });
    expect(mark(dialog!.querySelector("[data-ask-claude]"))).toEqual({ event: "connect_click", where: "ask-dialog", target: "claude" });
  });

  it("marks every copy button on /connect/, and each ask's two actions", () => {
    const doc = page("/connect/");
    const copies = all(doc, "button[data-copy]");
    expect(copies.length).toBeGreaterThanOrEqual(6);
    for (const b of copies) expect(mark(b)?.event, describe1(b)).toBe("connect_copy");
    const asks = all(doc, "[data-asks] [data-ask-ai]");
    expect(asks.length).toBe(5);
    for (const row of asks) {
      expect(mark(row.querySelector("[data-ask-copy]"))).toEqual({ event: "connect_copy", where: "connect-asks", target: "prompt" });
      expect(mark(row.querySelector("[data-ask-claude]"))).toEqual({ event: "connect_click", where: "connect-asks", target: "claude" });
    }
  });

  it("marks every Ask-your-AI row outside the dialog: Copy prompt and Open in Claude", () => {
    for (const { route, doc } of pages) {
      for (const row of doc.querySelectorAll("[data-ask-ai]")) {
        expect(mark(row.querySelector("[data-ask-copy]"))?.event, route).toBe("connect_copy");
        expect(mark(row.querySelector("[data-ask-claude]"))?.event, route).toBe("connect_click");
      }
    }
  });

  it("marks every resource's own link on Startup Resources with its id, cut to fit, and each id once", () => {
    const doc = page("/ecosystem-canvas/");
    const rows = all(doc, "[data-resource]");
    expect(rows.length).toBeGreaterThan(100);
    const seen = new Set<string>();
    for (const row of rows) {
      const id = row.getAttribute("data-id")!;
      const m = mark(row.querySelector("h3 a"));
      expect(m, id).toEqual({ event: "resource_out", where: "ecosystem-canvas", resource: shortSlug(id) });
      expect(seen.has(m!.resource!), `two resources share ${m!.resource}`).toBe(false);
      seen.add(m!.resource!);
    }
    const picks = all(doc, "[data-pick]");
    expect(picks.length).toBeGreaterThan(0);
    for (const pick of picks) {
      const id = pick.getAttribute("data-id")!;
      expect(mark(pick.querySelector(".hall-card__title a")), id).toEqual({
        event: "resource_out",
        where: "ecosystem-canvas-picks",
        resource: shortSlug(id),
      });
    }
  });

  it("marks every event's own link and every Add to calendar on /event-calendar/", () => {
    const doc = page("/event-calendar/");
    const own = all(doc, ".ev__title a, .ev-card__title a");
    expect(own.length).toBeGreaterThan(0);
    for (const a of own) {
      const m = mark(a);
      expect(m?.event, describe1(a)).toBe("event_out");
      expect(["event-calendar-list", "event-calendar-next"]).toContain(m?.where);
      expect(m?.source, describe1(a)).not.toBe("ics");
    }
    const ics = all(doc, "a[data-add-ics]");
    expect(ics.length).toBe(all(doc, "[data-event-list] li.ev").length);
    for (const a of ics) expect(mark(a)).toEqual({ event: "event_out", where: "event-calendar-list", source: "ics" });
  });

  it("names the submit event on each posted form and on its thanks page", () => {
    const pairs = [
      ["join/slack/index.html", "form[data-join-form]", "join/slack/thanks/index.html", "join_submit"],
      ["founders/index.html", "form[data-waitlist-form]", "founders/waitlist/thanks/index.html", "join_submit"],
      ["newsletter/index.html", "form[data-newsletter]", "newsletter/thanks/index.html", "newsletter_submit"],
    ] as const;
    for (const [formPage, selector, thanksPage, event] of pairs) {
      const form = parse(readDist(formPage)).querySelector(selector);
      expect(form?.getAttribute("data-submit-event"), formPage).toBe(event);
      const thanks = parse(readDist(thanksPage)).querySelectorAll("[data-submit-event]");
      expect(thanks.length, thanksPage).toBe(1);
      expect(thanks[0]!.getAttribute("data-submit-event"), thanksPage).toBe(event);
    }
  });
});
