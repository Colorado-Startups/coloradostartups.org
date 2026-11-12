import { describe, expect, it } from "vitest";

import { readDist } from "../pages";

// #702: the suggest form and its thanks page call the directory by its one
// name, Startup Resources (#141). "Ecosystem Canvas" stays only where the
// directory page credits the dataset. Built HTML from dist/.

describe.each(["ecosystem-canvas/suggest/index.html", "ecosystem-canvas/suggest/thanks/index.html"])("%s", (file) => {
  const doc = new DOMParser().parseFromString(readDist(file), "text/html");

  it("never names the Canvas, in the page or its meta description", () => {
    const meta = doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
    expect(`${doc.querySelector("main")?.textContent ?? ""} ${meta}`).not.toMatch(/Canvas/);
  });

  it("links back to Startup Resources by that name", () => {
    const back = [...doc.querySelectorAll('main a[href="/ecosystem-canvas/"]')].map((a) => a.textContent?.trim());
    expect(back).toContain("Back to Startup Resources");
  });
});
