import { describe, expect, it } from "vitest";

import { readDist } from "../pages";

// #724, the Startup Resources consistency row: the startup credits guide
// names the directory by its one name, not "the Map Room" (#141). Built HTML.

describe("/guides/startup-credits/", () => {
  const main = new DOMParser().parseFromString(readDist("guides/startup-credits/index.html"), "text/html").querySelector("main")!;

  it("calls the directory Startup Resources", () => {
    expect(main.textContent).not.toMatch(/Map Room/);
    expect(main.querySelector("#partners-title")?.textContent?.trim()).toBe("Find a partner in Startup Resources");
  });
});
