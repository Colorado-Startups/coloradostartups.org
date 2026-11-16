import { describe, expect, it } from "vitest";

import { calendarEmbedUrl } from "../../../src/components/info/links";
import { readDist } from "../pages";

// /event-calendar/ as it ships (#227), and a note behind the Google Calendar
// frame for when the frame is slow, blocked or hidden. Whether the frame
// covers the note is a layout fact, checked in Chrome by
// e2e/page-polish-calendar-frame.spec.ts. The events lead (Paul, 2026-11-16:
// "they're supposed to be getting info"): the header holds no picture, the
// next events follow it, and the Denver painting closes the page, lazily.

const d = new DOMParser().parseFromString(readDist("event-calendar/index.html"), "text/html");
const FOLLOWS = Node.DOCUMENT_POSITION_FOLLOWING;

describe("/event-calendar/ header and art", () => {
  const header = d.querySelector("main .info-header")!;
  const art = d.querySelectorAll<HTMLElement>("main [data-art]");

  it("keeps the header to the title and its two actions, with no picture", () => {
    expect(header.querySelectorAll("img, [data-art]")).toHaveLength(0);
    expect(header.querySelectorAll(".btn-row a.btn")).toHaveLength(2);
  });

  it("shows one described painting, after the next events and the add-your-event list", () => {
    expect(art).toHaveLength(1);
    const figure = art[0]!;
    expect(figure.dataset.art).toBe("brand/denver");
    const img = figure.querySelector("img");
    expect(img?.getAttribute("alt") ?? "").toMatch(/\w{4,}/);
    const list = d.getElementById("add-your-event")!.parentElement!.querySelector("ul")!;
    expect(list.compareDocumentPosition(figure) & FOLLOWS).toBeTruthy();
    const firstEvent = d.querySelector("main .info-header ~ *")!;
    expect(firstEvent.compareDocumentPosition(figure) & FOLLOWS).toBeTruthy();
  });

  it("loads it lazily, since it closes the page", () => {
    const img = art[0]!.querySelector("img");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("fetchpriority")).not.toBe("high");
  });
});

describe("/event-calendar/ frame fallback", () => {
  const frame = d.querySelector(".calendar .frame")!;
  const fallback = frame.querySelector(".fallback");

  it("sits inside the frame, before the iframe, so the iframe paints over it", () => {
    expect(fallback).not.toBeNull();
    const children = [...frame.children];
    expect(children.indexOf(fallback!)).toBeLessThan(children.indexOf(frame.querySelector("iframe")!));
  });

  it("links the same calendar on Google, with the space before the link kept", () => {
    expect(fallback!.querySelector("a")?.getAttribute("href")).toBe(calendarEmbedUrl());
    expect((fallback!.textContent ?? "").replace(/\s+/g, " ")).toMatch(/stays blank, open the calendar on Google\./);
  });

  it("stays out of the accessibility tree and the tab order, since the caption carries the link", () => {
    expect(fallback!.getAttribute("aria-hidden")).toBe("true");
    expect(fallback!.querySelector("a")?.getAttribute("tabindex")).toBe("-1");
    const caption = d.querySelector(".calendar figcaption")!;
    expect([...caption.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toContain(calendarEmbedUrl());
  });
});
