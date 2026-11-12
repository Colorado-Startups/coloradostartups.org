// L29b over the built site (run `npm run build` first; test:content does).
//   - /leaderboard/ links to the badge kit right after the edition summary.
//   - The kit page's CSS keeps a [hidden] copy button hidden. `.btn` sets
//     display, and an author rule beats the browser's own [hidden] rule, so
//     without `.kit-copy .btn[hidden] { display: none; }` the button shows
//     before the script runs. This test fails when that rule is missing.
//   - /privacy/ renders the L29b sections and keeps the reviewer note out.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DIST_DIR, readDist } from "../pages";

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
// Markdown turns ' into a curly apostrophe; compare against plain ASCII.
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

const KIT_LINK_TEXT = "Listed here? Get the honoree badge for your site.";

/** Every CSS rule the page loads: inline <style> blocks plus /_astro/ stylesheets. */
function pageCss(html: string): string {
  const page = doc(html);
  const inline = [...page.querySelectorAll("style")].map((s) => s.textContent ?? "");
  const linked = [...page.querySelectorAll<HTMLLinkElement>("link[rel='stylesheet'][href^='/']")].map((l) =>
    readFileSync(path.join(DIST_DIR, l.getAttribute("href")!), "utf8"),
  );
  return [...inline, ...linked].join("\n");
}

/**
 * Flat rules as { selectors, declarations }, with Astro's scoping attributes
 * removed so a selector reads as it does in the component source. Innermost
 * blocks only, which is enough for plain rules inside or outside @media.
 */
function cssRules(css: string): { selectors: string[]; declarations: string }[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: { selectors: string[]; declarations: string }[] = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!
      .replace(/\[data-astro-cid-[\w-]+\]/g, "")
      .replace(/:where\(\.astro-[\w-]+\)/g, "")
      .split(",")
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    rules.push({ selectors, declarations: m[2]!.replace(/\s+/g, "").toLowerCase() });
  }
  return rules;
}

const hidesWith = (css: string, selector: string) =>
  cssRules(css).some((r) => r.selectors.includes(selector) && /(^|;)display:none(!important)?(;|$)/.test(r.declarations));

describe("cssRules, the parser this file relies on", () => {
  it("finds a scoped rule and ignores one for another selector", () => {
    const known = ".kit-copy[data-astro-cid-x1] .btn[data-astro-cid-x1][hidden]{display:none}";
    expect(hidesWith(known, ".kit-copy .btn[hidden]")).toBe(true);
    expect(hidesWith(".kit-copy[data-astro-cid-x1] .meta{margin:0}", ".kit-copy .btn[hidden]")).toBe(false);
    expect(hidesWith(".kit-copy .btn[hidden]{display:block}", ".kit-copy .btn[hidden]")).toBe(false);
  });
});

describe("/leaderboard/ links to the badge kit", () => {
  const page = doc(readDist("leaderboard/index.html"));

  it("has the kit link, with its exact words, right after the edition summary", () => {
    const links = [...page.querySelectorAll<HTMLAnchorElement>("main a[href='/leaderboard/kit/']")];
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(text(link)).toBe(KIT_LINK_TEXT);
    const para = link.parentElement!;
    expect(para.tagName).toBe("P");
    expect(text(para)).toBe(KIT_LINK_TEXT);
    // The paragraph before it is the edition summary, under the edition heading.
    const summary = para.previousElementSibling!;
    expect(summary.tagName).toBe("P");
    expect(summary.previousElementSibling?.tagName).toBe("H2");
    expect(text(summary)).toMatch(/2026 Overall, Startup and Community Picks boards/);
  });

  it("points at a page that is in the build", () => {
    expect(() => readDist("leaderboard/kit/index.html")).not.toThrow();
  });
});

describe("/leaderboard/kit/ without JavaScript", () => {
  const html = readDist("leaderboard/kit/index.html");
  const page = doc(html);

  it("ships each copy button with the hidden attribute and the .btn class", () => {
    const buttons = [...page.querySelectorAll<HTMLButtonElement>(".kit-copy button[data-copy]")];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(b.hidden).toBe(true);
      expect(b.classList.contains("btn")).toBe(true);
    }
  });

  it("loads a .btn rule that sets display, so [hidden] alone would not hide the button", () => {
    const css = pageCss(html);
    const btn = cssRules(css).filter((r) => r.selectors.includes(".btn"));
    expect(btn.some((r) => /(^|;)display:/.test(r.declarations))).toBe(true);
  });

  it("loads the rule that hides a [hidden] copy button", () => {
    expect(hidesWith(pageCss(html), ".kit-copy .btn[hidden]")).toBe(true);
  });

  it("keeps a space between \"write to\" and the email link", () => {
    const link = page.querySelector<HTMLAnchorElement>("main a[href='mailto:info@coloradostartups.org']")!;
    expect(link).not.toBeNull();
    const before = link.previousSibling?.textContent ?? "";
    expect(before).toMatch(/write to\s$/);
    expect(text(link.parentElement)).toContain("write to info@coloradostartups.org.");
  });
});

describe("/privacy/ after L29b", () => {
  const html = readDist("privacy/index.html");
  const main = doc(html).querySelector("main")!;
  const body = text(main);

  it("names the Google Form that starts joining the Slack", () => {
    expect(body).toContain("Joining starts with a short Google Form.");
    expect(body).toContain("Google hosts the form, and Google's privacy policy covers your visit to it.");
    expect(body).toContain("The form says what it asks for and why.");
    const slack = [...main.querySelectorAll("p")].find((el) => text(el.querySelector("strong")) === "Joining our Slack.");
    expect(text(slack)).toBe(
      "Joining our Slack. Joining starts with a short Google Form. Google hosts the form, and Google's privacy policy covers your visit to it. The form says what it asks for and why.",
    );
    // No bullet list of promises about the form's answers follows it.
    expect(slack?.nextElementSibling?.tagName).toBe("P");
    const googleRow = [...main.querySelectorAll("tr")].find((tr) => text(tr.querySelector("td")) === "Google");
    expect(text(googleRow)).toContain("Google Forms");
  });

  it("says the Leaderboard shows the HQ city, not the county from the form", () => {
    expect(body).toContain("We take the HQ city from the company's own website or press coverage, not from the form.");
    expect(body).toContain("the Leaderboard does not show it.");
  });

  it("gives a period for nominator details, messages and security reports", () => {
    expect(body).toContain("we delete your name and email from the nomination");
    expect(body).toContain(
      "At our monthly check, we delete each conversation whose last message is more than 12 months old (our commitment).",
    );
    // L29g: the security-report purge and the nomination sweep run weekly.
    expect(body).toContain("A weekly job deletes each type of report that no browser has sent in the last 90 days (our commitment).");
    expect(body).toContain(
      "If your nomination is still waiting for an edition when it is 180 days old, a weekly job deletes the figures, your name and your email (our commitment).",
    );
    expect(body).toContain("No nomination waiting for an edition keeps its figures, name or email longer than 187 days (our commitment).");
    expect(body.match(/monthly check/g)).toHaveLength(1);
  });

  it("says Turnstile receives your IP address, from your browser and from us, with its source", () => {
    const item = [...main.querySelectorAll("li")].find((li) => text(li.querySelector("strong")) === "Bot protection.");
    expect(text(item)).toContain(
      "Turnstile receives your IP address from your browser when the check runs, and from us when we confirm the result.",
    );
    expect(text(item)).toContain("(Cloudflare's Turnstile Privacy Addendum, read 2026-10-22).");
  });

  it("says the request logs hold your IP address, and how long Cloudflare keeps them", () => {
    const item = [...main.querySelectorAll("li")].find((li) => text(li.querySelector("strong")) === "Request logs.");
    expect(text(item)).toContain(
      "with its headers, which include your IP address, and the approximate location Cloudflare matches to that address.",
    );
    expect(text(item)).toContain("Cloudflare keeps them for up to 7 days (Cloudflare's Workers Logs documentation, read 2026-10-22).");
    expect(body).toContain("We do not store it with anything you send.");
  });

  it("dates the change note and keeps the reviewer note out of the page source", () => {
    expect(body).toContain("October 22, 2026. We named the Google Form that starts joining our Slack.");
    expect(body).toContain("We added the request logs Cloudflare keeps for our server code, which include your IP address.");
    expect(html).not.toContain("Approved at Gate B");
    expect(html).not.toMatch(/<!--\s*DRAFT/);
  });
});
