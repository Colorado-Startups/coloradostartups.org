// The forms' Turnstile boxes over the built site (run `npm run build` first;
// test:content does). #121: no page loads Cloudflare's challenge with the
// page; components/forms/turnstile.ts loads it when a visitor starts on a
// form. #203: each box takes no room unless a challenge needs the visitor.
import { describe, expect, it } from "vitest";

import { builtPages, readDist } from "../pages";

const FORMS = {
  "index.html": "/api/subscribe",
  "newsletter/index.html": "/api/subscribe",
  "community/index.html": "/api/subscribe",
  "ecosystem-canvas/suggest/index.html": "/api/suggest-resource",
  "get-involved/apply/index.html": "/api/apply",
  "leaderboard/nominate/index.html": "/api/nominate",
};

// CI builds without PUBLIC_TURNSTILE_SITE_KEY. Then SuggestForm shows a note
// in place of its box, and the other forms render a box with an empty key.
const parse = (file: string) => new DOMParser().parseFromString(readDist(file), "text/html");
const KEYED = Boolean(parse("index.html").querySelector<HTMLElement>(".cf-turnstile")?.dataset.sitekey);

describe.each(Object.entries(FORMS))("%s", (file, action) => {
  const form = parse(file).querySelector(`form[action="${action}"]`);
  const box = form?.querySelector<HTMLElement>(".cf-turnstile");

  it.runIf(KEYED || action !== "/api/suggest-resource")("holds one lazy, interaction-only Turnstile box before its submit button", () => {
    expect(form?.querySelectorAll(".cf-turnstile")).toHaveLength(1);
    expect(box?.hasAttribute("data-turnstile-lazy")).toBe(true);
    expect(box?.dataset.appearance).toBe("interaction-only");
    expect(box?.hasAttribute("data-sitekey")).toBe(true);
    const submit = form?.querySelector("button[type='submit']");
    expect(submit && box && box.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.runIf(!KEYED && action === "/api/suggest-resource")("says verification is not set up on a build with no site key", () => {
    expect(box ?? null).toBeNull();
    expect(form?.textContent).toContain("Verification is not set up on this build");
  });
});

describe("every built page", () => {
  it("loads no Cloudflare challenge script with the page", () => {
    const loaders = builtPages()
      .filter((p) => /<script[^>]+src=["']?https:\/\/challenges\.cloudflare\.com/i.test(p.html))
      .map((p) => p.route);
    expect(loaders).toEqual([]);
  });
});
