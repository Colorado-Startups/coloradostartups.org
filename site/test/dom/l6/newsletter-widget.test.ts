// The newsletter panel over the built site (run `npm run build` first;
// test:content does). #211: at 375 px, Turnstile's flexible widget has a
// minimum width wider than the panel's content box, so the widget takes no
// room unless a challenge needs the visitor.
import { describe, expect, it } from "vitest";

import { readDist } from "../pages";

const PAGES = ["index.html", "newsletter/index.html", "community/index.html"];

describe.each(PAGES)("%s newsletter form", (file) => {
  const doc = new DOMParser().parseFromString(readDist(file), "text/html");
  const form = doc.querySelector("form[data-newsletter]");

  it("shows Turnstile only when a challenge needs the visitor", () => {
    const widget = form?.querySelector<HTMLElement>(".cf-turnstile");
    expect(widget?.dataset.appearance).toBe("interaction-only");
    expect(widget?.dataset.size).toBe("flexible");
  });
});
