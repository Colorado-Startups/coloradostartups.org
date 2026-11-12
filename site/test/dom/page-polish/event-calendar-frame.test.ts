import { describe, expect, it } from "vitest";

import { calendarEmbedUrl } from "../../../src/components/info/links";
import { readDist } from "../pages";

// /event-calendar/ as it ships (#227): art in the page header, and a note
// behind the Google Calendar frame for when the frame is slow, blocked or
// hidden. Whether the frame covers the note is a layout fact, checked in
// Chrome by e2e/page-polish-calendar-frame.spec.ts.

const d = new DOMParser().parseFromString(readDist("event-calendar/index.html"), "text/html");

describe("/event-calendar/ header art", () => {
  const img = d.querySelector(".cal-head img");

  it("shows one described illustration beside the page header", () => {
    expect(d.querySelectorAll(".cal-head img")).toHaveLength(1);
    expect(img?.getAttribute("alt") ?? "").toMatch(/\w{4,}/);
  });

  it("loads it with the first screen, not lazily", () => {
    expect(img?.getAttribute("loading")).toBe("eager");
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
