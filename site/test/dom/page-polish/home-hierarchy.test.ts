import { WAYS_IN } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { readDist } from "../pages";

// Page polish (#201): the home hero leads with one gold action, and two
// sections carry a Banner so the section titles do not all read alike.

const home = new DOMParser().parseFromString(readDist("index.html"), "text/html");
const hero = home.querySelector("main .hero")!;

describe("home hero actions", () => {
  it("has one gold button, Join the Slack", () => {
    const gold = [...hero.querySelectorAll(".btn--gold")];
    expect(gold).toHaveLength(1);
    expect(gold[0]!.getAttribute("href")).toBe(WAYS_IN.slack);
  });

  it("shows the LinkedIn Group and the newsletter as quiet links, not bronze buttons", () => {
    expect(hero.querySelectorAll(".btn--bronze")).toHaveLength(0);
    for (const href of [WAYS_IN["linkedin-group"], WAYS_IN.newsletter]) {
      expect(hero.querySelector(`a.btn--quiet[href="${href}"]`), href).not.toBeNull();
    }
  });
});

describe("home section titles", () => {
  it("sets Ways in and Inside the Hall as banners, each still an h2 that names its section", () => {
    for (const id of ["ways-in", "rooms"]) {
      const heading = home.getElementById(id);
      expect(heading?.tagName, id).toBe("H2");
      expect(heading?.closest(".hall-banner"), id).not.toBeNull();
      expect(home.querySelector(`section[aria-labelledby="${id}"]`), id).not.toBeNull();
    }
  });

  it("keeps a plain h2 on the other sections", () => {
    for (const id of ["start", "regions", "keepers"]) {
      expect(home.getElementById(id)?.closest(".hall-banner"), id).toBeNull();
    }
  });
});
