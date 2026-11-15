import { WAYS_IN } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { readDist } from "../pages";

// The home hero leads with one gold action, Join the Slack (#201), and the
// redesign (2026-11-15) puts the LinkedIn Group beside it as the one bronze
// button: Paul asked for the Slack and the LinkedIn Group first.

const home = new DOMParser().parseFromString(readDist("index.html"), "text/html");
const hero = home.querySelector("main .hero")!;

describe("home hero actions", () => {
  it("has one gold button, Join the Slack", () => {
    const gold = [...hero.querySelectorAll(".btn--gold")];
    expect(gold).toHaveLength(1);
    expect(gold[0]!.getAttribute("href")).toBe(WAYS_IN.slack);
  });

  it("shows the LinkedIn Group as the one bronze button", () => {
    const bronze = [...hero.querySelectorAll(".btn--bronze")];
    expect(bronze.map((a) => a.getAttribute("href"))).toEqual([WAYS_IN["linkedin-group"]]);
  });
});

describe("home section titles", () => {
  it("names each section with an h2 its section points to", () => {
    for (const id of ["where", "why", "explore", "ask"]) {
      expect(home.getElementById(id)?.tagName, id).toBe("H2");
      expect(home.querySelector(`section[aria-labelledby="${id}"]`), id).not.toBeNull();
    }
  });
});
