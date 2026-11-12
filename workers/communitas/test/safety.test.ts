import { describe, expect, it } from "vitest";

import { cleanQuestion, hashUserId, sanitizeModelText } from "../src/safety";

describe("sanitizeModelText: model output can never ping or link", () => {
  it.each([
    ["<!channel> hello", "hello"],
    ["<!here> hello", "hello"],
    ["<!everyone> hello", "hello"],
    ["<!here|here> hello", "hello"],
    ["<!subteam^S0123|@founders> hello", "hello"],
    ["hi <@U0123ABC> and <@W0456|pat>", "hi and"],
    ["see <#C0123> or <#C0456|general>", "see or"],
  ])("strips Slack control sequences from %j", (input, expected) => {
    expect(sanitizeModelText(input)).toBe(expected);
  });

  it("strips plain-text mass mentions too", () => {
    expect(sanitizeModelText("@here @channel @everyone look")).toBe("look");
  });

  it("removes raw URLs so the model cannot inject a link", () => {
    expect(sanitizeModelText("Go to https://evil.example/x?y=1 now, or http://a.b or www.c.d")).toBe(
      "Go to now, or or",
    );
  });

  it.each([
    // The glued word goes with the URL; losing it is the safe failure.
    ["visithttps://evil.com now", "now"],
    ["go to evil.com/login", "go to"],
    ["try ftp://files.example/x", "try"],
    ["see Sub.Domain.example.co/path?q=1 today", "see today"],
  ])("removes a URL with no word boundary, another scheme or no scheme: %j", (input, expected) => {
    expect(sanitizeModelText(input)).toBe(expected);
  });

  it("keeps ordinary prose with periods", () => {
    expect(sanitizeModelText("It helps founders. Apply in spring.")).toBe("It helps founders. Apply in spring.");
  });

  it("removes Slack link syntax with its label", () => {
    expect(sanitizeModelText("click <https://evil.example|here> please")).toBe("click please");
  });

  it("escapes &, < and > so no new control sequence can form", () => {
    expect(sanitizeModelText("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });

  it("does not let an escaped sequence decode back into a mention", () => {
    const out = sanitizeModelText("&lt;!channel&gt;");
    expect(out).not.toMatch(/<!/);
    expect(out).toBe("&amp;lt;!channel&amp;gt;");
  });

  it("keeps line breaks but collapses runs of spaces", () => {
    expect(sanitizeModelText("one  two\n\n\n\nthree")).toBe("one two\n\nthree");
  });

  it("caps very long text", () => {
    const out = sanitizeModelText("word ".repeat(2000));
    expect(out.length).toBeLessThanOrEqual(2800);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("cleanQuestion: what leaves the Worker for Resourcus", () => {
  it("drops every user mention, so no raw Slack user id leaves the Worker", () => {
    expect(cleanQuestion("<@UBOT123> who helps <@U999|sam> with legal?")).toBe("who helps with legal?");
  });

  it("keeps channel names as plain text and drops bare channel ids", () => {
    expect(cleanQuestion("<@UBOT> asked in <#C1|boulder> and <#C2>")).toBe("asked in #boulder and");
  });

  it("drops mass mentions", () => {
    expect(cleanQuestion("<!here> <@UBOT> where to start?")).toBe("where to start?");
  });

  it("turns Slack links into their label or plain URL text, without fetching anything", () => {
    expect(cleanQuestion("<@UBOT> is <https://x.example|this program> or <https://y.example> good?")).toBe(
      "is this program or https://y.example good?",
    );
  });

  it("decodes Slack's HTML escapes", () => {
    expect(cleanQuestion("<@UBOT> R&amp;D credits &lt;2 years?")).toBe("R&D credits <2 years?");
  });
});

describe("hashUserId", () => {
  it("is a stable salted HMAC in hex", async () => {
    const a = await hashUserId("U123", "salt-1");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashUserId("U123", "salt-1")).toBe(a);
  });

  it("changes with the salt and with the user", async () => {
    const a = await hashUserId("U123", "salt-1");
    expect(await hashUserId("U123", "salt-2")).not.toBe(a);
    expect(await hashUserId("U124", "salt-1")).not.toBe(a);
  });

  it("never contains the raw id", async () => {
    expect(await hashUserId("U0ABCDEF", "s")).not.toContain("U0ABCDEF");
  });

  it("refuses an empty salt", async () => {
    await expect(hashUserId("U123", "")).rejects.toThrow(/salt/);
  });
});
