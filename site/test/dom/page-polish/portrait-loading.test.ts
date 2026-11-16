// Page polish, #428, over the built site (run `npm run build` first;
// test:content does). Since 2026-11-16 the log leads /dispatches/ (Paul:
// "they're supposed to be getting info"), and the Publicus portrait closes
// the page under it with its disclosure, so it loads lazily like every other
// keeper portrait: Portrait's default.
import { describe, expect, it } from "vitest";

import { readDist } from "../pages";

const doc = (route: string) => new DOMParser().parseFromString(readDist(route), "text/html");

describe("keeper portrait loading (#428)", () => {
  it("puts the Publicus portrait under the log on /dispatches/, lazily, with no raised priority", () => {
    const page = doc("dispatches/index.html");
    const img = page.querySelector("main [data-portrait='publicus'] img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("fetchpriority")).not.toBe("high");
    expect(img?.getAttribute("alt")).toContain("AI agent");
    const log = page.querySelector("main ol.log")!;
    expect(log).not.toBeNull();
    expect(log.compareDocumentPosition(img!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the keeper portraits on /team/ lazy, with no raised priority", () => {
    const imgs = [...doc("team/index.html").querySelectorAll("main [data-portrait] img")];
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.getAttribute("fetchpriority")).not.toBe("high");
    }
  });
});
