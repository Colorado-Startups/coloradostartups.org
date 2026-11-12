// L9: the pure feed builders behind /feed.json and /rss.xml. The built files
// are checked again in test/dom/l9/ after a real build.
import { FeedSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";

import {
  buildFeed,
  buildRss,
  calendarDate,
  clip,
  CONTENT_TEXT_MAX,
  denverMidnight,
  type FeedEntry,
  rfc822,
  toPlainText,
  xmlEscape,
} from "../../../src/components/dispatches/feed";

const SITE = new URL("https://coloradostartups.org");

const entry = (over: Partial<FeedEntry>): FeedEntry => ({
  kind: "dispatch",
  path: "/dispatches/x/",
  title: "A dispatch",
  text: "Body text.",
  date: "2026-10-06",
  tags: [],
  ...over,
});

describe("denverMidnight", () => {
  it("uses MDT in summer and MST in winter", () => {
    expect(denverMidnight("2026-10-06")).toBe("2026-10-06T00:00:00-06:00");
    expect(denverMidnight("2026-12-01")).toBe("2026-12-01T00:00:00-07:00");
  });

  it("reads the offset that held at local midnight on both change days", () => {
    // 2026: DST starts Mar 8 and ends Nov 1 (US rule: second Sunday in March, first in November).
    expect(denverMidnight("2026-03-08")).toBe("2026-03-08T00:00:00-07:00");
    expect(denverMidnight("2026-11-01")).toBe("2026-11-01T00:00:00-06:00");
  });

  it("refuses anything but a calendar date", () => {
    expect(() => denverMidnight("2026-10-06T00:00:00Z")).toThrow();
    expect(() => denverMidnight("Oct 6")).toThrow();
  });

  it("matches the day Astro's coerced dates carry", () => {
    expect(calendarDate(new Date("2026-10-06"))).toBe("2026-10-06");
  });
});

describe("toPlainText", () => {
  it("keeps a link's text, and adds the address only when the text does not show it", () => {
    expect(toPlainText("At [luma.com/startup-community-project](https://luma.com/startup-community-project).")).toBe(
      "At luma.com/startup-community-project.",
    );
    expect(toPlainText("See [the Canvas](https://coloradostartups.org/ecosystem-canvas/).")).toBe(
      "See the Canvas (https://coloradostartups.org/ecosystem-canvas/).",
    );
  });

  it("compares the whole address, so link text inside the URL does not drop it", () => {
    expect(toPlainText("Read it [here](https://x.com/where).")).toBe("Read it here (https://x.com/where).");
    expect(toPlainText("[x.com](https://x.com/where)")).toBe("x.com (https://x.com/where)");
    expect(toPlainText("[paul@coloradostartups.org](mailto:paul@coloradostartups.org)")).toBe(
      "paul@coloradostartups.org",
    );
  });

  it("drops headings, emphasis, quotes, code and image syntax", () => {
    const md = "## News\n\n**Bold** and *soft* and `code`.\n\n> Quoted\n\n![A hall](/x.png)";
    expect(toPlainText(md)).toBe("News\n\nBold and soft and code.\n\nQuoted\n\nA hall");
  });

  it("keeps list markers and arithmetic stars", () => {
    expect(toPlainText("- one\n- two")).toBe("- one\n- two");
    expect(toPlainText("2 * 3 = 6")).toBe("2 * 3 = 6");
  });
});

describe("clip", () => {
  it("leaves short text alone", () => {
    expect(clip("short", 10)).toBe("short");
  });

  it("cuts at a word boundary, ends with an ellipsis, and stays within the limit", () => {
    const text = "word ".repeat(600).trim();
    const out = clip(text);
    expect(out.length).toBeLessThanOrEqual(CONTENT_TEXT_MAX);
    expect(out.endsWith("word…")).toBe(true);
  });

  it("cuts mid-word only when there is no space to cut at", () => {
    expect(clip("x".repeat(50), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("buildFeed", () => {
  const feed = buildFeed(
    [
      entry({ path: "/dispatches/old/", title: "Old", date: "2026-10-01" }),
      entry({ kind: "resource", path: "/ecosystem-canvas/#r-a", title: "A", date: "2026-10-08" }),
      entry({ kind: "edition", path: "/leaderboard/#e", title: "E", date: "2026-10-08", summary: "An edition." }),
      entry({ path: "/dispatches/new/", title: "New", date: "2026-10-08", text: "y ".repeat(1500) }),
    ],
    SITE,
  );

  it("parses with FeedSchema", () => {
    expect(() => FeedSchema.parse(feed)).not.toThrow();
  });

  it("orders newest first, then dispatch, edition, resource on the same day", () => {
    expect(feed.items.map((i) => i.title)).toEqual(["New", "E", "A", "Old"]);
  });

  it("uses absolute URLs as ids and tags each item with its kind", () => {
    expect(feed.items[0]?.id).toBe("https://coloradostartups.org/dispatches/new/");
    expect(feed.items[0]?.url).toBe(feed.items[0]?.id);
    expect(feed.items.map((i) => i._cs.kind)).toEqual(["dispatch", "edition", "resource", "dispatch"]);
  });

  it("keeps content_text within FeedSchema's limit and passes summaries through", () => {
    for (const item of feed.items) expect(item.content_text.length).toBeLessThanOrEqual(CONTENT_TEXT_MAX);
    expect(feed.items[1]?.summary).toBe("An edition.");
    expect(feed.items[0]).not.toHaveProperty("summary");
  });

  it("points at itself and the home page", () => {
    expect(feed.feed_url).toBe("https://coloradostartups.org/feed.json");
    expect(feed.home_page_url).toBe("https://coloradostartups.org/");
  });
});

describe("buildRss", () => {
  const feed = buildFeed([entry({ title: 'Founders & "friends" <3', summary: "It's here." })], SITE);
  const xml = buildRss(feed, SITE);

  it("escapes text for XML", () => {
    expect(xmlEscape(`a & b < c > d " e ' f`)).toBe("a &amp; b &lt; c &gt; d &quot; e &apos; f");
    expect(xml).toContain("<title>Founders &amp; &quot;friends&quot; &lt;3</title>");
    expect(xml).toContain("<description>It&apos;s here.</description>");
  });

  it("carries RFC 822 dates and a self link", () => {
    expect(rfc822("2026-10-06T00:00:00-06:00")).toBe("Tue, 06 Oct 2026 06:00:00 GMT");
    expect(xml).toContain("<pubDate>Tue, 06 Oct 2026 06:00:00 GMT</pubDate>");
    expect(xml).toContain('<atom:link href="https://coloradostartups.org/rss.xml" rel="self" type="application/rss+xml" />');
  });
});
