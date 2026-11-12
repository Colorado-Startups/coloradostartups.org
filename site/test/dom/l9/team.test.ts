// L9 over the built site (run `npm run build` first; test:content does):
// /team/ and /get-involved/ render from data/team/*.yaml, every keeper card
// carries its disclosure in full, and every open seat has a working
// "Email us about this seat" email, or an "Apply for this seat" link for a seat that
// takes applications (L19).
import { readFileSync } from "node:fs";
import path from "node:path";

import { comparePositions, DwarfSchema, PersonSchema, PositionSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { REGIONS } from "../../../src/lib/regions/match";
import { readDist, SITE_DIR } from "../pages";
import { ON_FIXTURES } from "../../people-source";
import { axeViolations } from "./axe";

const TEAM_DATA = path.resolve(SITE_DIR, "..", "data", "team");
const read = (file: string) => parse(readFileSync(path.join(TEAM_DATA, file), "utf8")) as unknown[];
const keepers = read("dwarves.yaml").map((d) => DwarfSchema.parse(d));
const people = read("people.yaml").map((p) => PersonSchema.parse(p));
const positions = read("positions.yaml").map((p) => PositionSchema.parse(p));

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

function headingLevelsStep(page: Document): void {
  const levels = [...page.querySelectorAll("main :is(h1, h2, h3, h4, h5, h6)")].map((h) => Number(h.tagName[1]));
  expect(levels[0]).toBe(1);
  for (let i = 1; i < levels.length; i += 1) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
}

function idsUnique(page: Document): void {
  const ids = [...page.querySelectorAll("[id]")].map((e) => e.id);
  expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
}

describe("/team/", () => {
  const source = readDist("team/index.html");
  const page = doc(source);
  const main = page.querySelector("main")!;

  it("shows leadership, keepers, community team, volunteers and with thanks, in that order", () => {
    const order = [...main.querySelectorAll(":scope > section[id]")].map((s) => s.id);
    expect(order).toEqual(["leadership", "keepers", "community-team", "volunteers", "with-thanks"]);
  });

  // The tests that name real people skip on fixtures (the public repo).
  it.skipIf(ON_FIXTURES)("puts Paul, Founder & President, under leadership", () => {
    const card = page.querySelector("#leadership [data-person='paul-foley']");
    expect(text(card?.querySelector("h3"))).toBe("Paul Foley");
    expect(text(card)).toContain("Founder & President");
    expect(text(card)).not.toMatch(/invest/i);
  });

  it("renders one card per keeper, in file order", () => {
    const cards = [...page.querySelectorAll<HTMLElement>("#keepers [data-keeper]")];
    expect(cards.map((c) => c.dataset.keeper)).toEqual(keepers.map((k) => k.id));
  });

  for (const keeper of keepers) {
    describe(`keeper card: ${keeper.name}`, () => {
      const card = page.querySelector(`[data-keeper='${keeper.id}']`);

      it("shows its disclosure line in full (hard constraint 10)", () => {
        const disclosure = card?.querySelector("[data-disclosure]");
        expect(disclosure).not.toBeNull();
        expect(text(disclosure)).toBe(keeper.disclosure);
        expect(disclosure?.closest("[hidden], [aria-hidden='true'], .visually-hidden")).toBeNull();
      });

      it("shows name, title, kind, role, bio and what it can help with", () => {
        expect(text(card?.querySelector("h3"))).toBe(keeper.name);
        expect(text(card)).toContain(keeper.title);
        expect(text(card?.querySelector("[data-kind-label]")).toLowerCase()).toBe(keeper.kind);
        expect(card?.getAttribute("data-kind")).toBe(keeper.kind);
        expect(text(card)).toContain(keeper.role);
        expect(text(card)).toContain(keeper.bio.replace(/\s+/g, " ").trim());
        for (const item of keeper.can_help_with) expect(text(card)).toContain(item);
        expect(text(card)).toContain("AI agent");
      });

      it("has a portrait or a labelled placeholder", () => {
        const art = card?.querySelector("img[alt], [role='img'][aria-label]");
        expect(art).not.toBeNull();
      });
    });
  }

  it("shows the people in filled seats, and links to the open positions", () => {
    const filled = positions.filter((p) => p.status === "filled").map((p) => p.holder);
    const shown = [...page.querySelectorAll<HTMLElement>("#community-team [data-person]")].map((c) => c.dataset.person);
    expect(shown.sort()).toEqual([...filled].sort());
    if (positions.some((p) => p.status === "open")) {
      expect(page.querySelector("#community-team a[href='/get-involved/']")).not.toBeNull();
    }
  });

  it.skipIf(ON_FIXTURES)("keeps Ryan Shuken under community volunteers", () => {
    const ids = [...page.querySelectorAll<HTMLElement>("#volunteers [data-person]")].map((c) => c.dataset.person);
    // people.yaml order, not id order.
    expect(ids).toEqual(people.filter((p) => p.group === "volunteers").map((p) => p.id));
    expect(ids).toContain("ryan-shuken");
  });

  it.skipIf(ON_FIXTURES)("thanks Micah and Lindsey with their photos and the Startup Community Project link", () => {
    const order = [...page.querySelectorAll<HTMLElement>("#with-thanks [data-person]")].map((c) => c.dataset.person);
    expect(order).toEqual(people.filter((p) => p.group === "with-thanks").map((p) => p.id));
    for (const id of ["micah-mador", "lindsey-rohde"]) {
      const card = page.querySelector(`#with-thanks [data-person='${id}']`);
      const person = people.find((p) => p.id === id)!;
      expect(card, id).not.toBeNull();
      expect(card?.querySelector("img")?.getAttribute("alt")).toBe(`Photo of ${person.name}`);
      expect(card?.querySelector("a[href='https://luma.com/startup-community-project']")).not.toBeNull();
      expect(text(card)).toContain("did an incredible job");
    }
  });

  it("orders headings without skipping a level, and keeps ids unique", () => {
    headingLevelsStep(page);
    idsUnique(page);
  });

  // GO-LIVE C3: one Colorado Startups. The home page declares the Organization;
  // this page points at it by @id and adds Paul, whose @id the home page's
  // founder carries.
  describe.skipIf(ON_FIXTURES)("JSON-LD", () => {
    const ORG_ID = "https://coloradostartups.org/#organization";
    const ld = JSON.parse(page.querySelector("script[type='application/ld+json']")?.textContent ?? "{}");
    const graph = (ld["@graph"] ?? []) as Record<string, any>[];
    const about = graph.find((n) => n["@type"] === "AboutPage");
    const paul = graph.find((n) => n["@type"] === "Person");

    it("is an AboutPage about the home page's Organization, by @id", () => {
      expect(about?.mainEntity["@id"]).toBe(ORG_ID);
      expect(about?.isPartOf).toEqual({ "@id": "https://coloradostartups.org/#website" });
    });

    it("declares no second set of Organization facts", () => {
      expect(Object.keys(about?.mainEntity ?? {}).sort()).toEqual(["@id", "@type", "name", "url"]);
      expect(graph.filter((n) => n["@type"] === "Organization")).toEqual([]);
    });

    it("describes Paul once, with the @id the home page's founder uses", () => {
      expect(paul?.name).toBe("Paul Foley");
      expect(paul?.jobTitle).toBe("Founder & President");
      expect(paul?.["@id"]).toBe("https://coloradostartups.org/team/#paul-foley");
      expect(paul?.worksFor).toEqual({ "@id": ORG_ID });
      const home = doc(readDist("index.html"));
      const homeLd = JSON.parse(home.querySelector("script[type='application/ld+json']")?.textContent ?? "{}");
      const org = (homeLd["@graph"] ?? []).find((n: Record<string, any>) => n["@type"] === "Organization");
      expect(org?.founder["@id"]).toBe(paul?.["@id"]);
    });

    it("gives Paul an @id whose fragment lands on his card", () => {
      expect(page.getElementById(new URL(paul?.["@id"]).hash.slice(1))).not.toBeNull();
    });
  });

  it("passes axe (structure and ARIA)", async () => {
    expect(await axeViolations(source)).toEqual([]);
  });
});

describe("/get-involved/", () => {
  const source = readDist("get-involved/index.html");
  const page = doc(source);
  const main = page.querySelector("main")!;
  const cards = [...page.querySelectorAll<HTMLElement>("[data-position]")];

  it("renders every position once, grouped community, regions, projects, in comparePositions() order", () => {
    const sorted = [...positions].sort(comparePositions(REGIONS));
    expect(cards.map((c) => c.dataset.position)).toEqual(sorted.map((p) => p.id));
    const groups = [...page.querySelectorAll<HTMLElement>("[data-position-group]")];
    expect(groups.map((g) => g.id)).toEqual(["community", "regions", "projects"]);
    for (const group of groups) {
      for (const card of group.querySelectorAll<HTMLElement>("[data-position]")) {
        expect(card.dataset.area).toBe(group.dataset.positionGroup);
      }
    }
  });

  for (const position of positions) {
    it(`shows title, summary, what you do and status for ${position.id}`, () => {
      const card = page.querySelector(`[data-position='${position.id}']`);
      expect(text(card?.querySelector("h3"))).toBe(position.title);
      expect(text(card)).toContain(position.summary);
      for (const line of position.what_you_do) expect(text(card)).toContain(line);
      expect(card?.getAttribute("data-status")).toBe(position.status);
      expect(text(card)).toContain(position.status === "open" ? "Open seat" : "Filled");
    });
  }

  const applying = (p: (typeof positions)[number]) => p.status === "open" && p.apply?.open === true;

  it("opens an email to info@ with the seat in the subject, and shows the address as text", () => {
    for (const position of positions.filter((p) => p.status === "open" && !applying(p))) {
      const card = page.querySelector(`[data-position='${position.id}']`)!;
      const link = card.querySelector<HTMLAnchorElement>("a[data-raise-hand]");
      const href = new URL(link?.getAttribute("href") ?? "");
      expect(href.protocol).toBe("mailto:");
      expect(href.pathname).toBe("info@coloradostartups.org");
      expect(decodeURIComponent(href.searchParams.get("subject") ?? "")).toContain(position.title);
      expect(text(link)).toBe(`Email us about this seat (${position.title})`);
      expect(text(card)).toContain("info@coloradostartups.org");
    }
  });

  it("links a seat that takes applications to the form with the seat preselected, and offers no email", () => {
    const seats = positions.filter(applying);
    expect(seats.length).toBeGreaterThan(0);
    for (const position of seats) {
      const card = page.querySelector(`[data-position='${position.id}']`)!;
      const link = card.querySelector<HTMLAnchorElement>("a[data-apply]");
      expect(link?.getAttribute("href")).toBe(`/get-involved/apply/?role=${position.id}`);
      expect(text(link)).toBe(`Apply for this seat (${position.title})`);
      expect(card.querySelector("a[data-raise-hand]")).toBeNull();
    }
  });

  it("leads the first screen with one gold button to the seat list, and keeps the group jumps quiet (#229)", () => {
    const hero = main.querySelector("section[aria-labelledby='involved-title']")!;
    const gold = [...hero.querySelectorAll<HTMLAnchorElement>("a.btn--gold")];
    expect(gold.map((a) => text(a))).toEqual(["See open seats"]);
    const target = page.getElementById((gold[0]?.getAttribute("href") ?? "").replace(/^#/, ""));
    expect(target?.contains(cards[0]!)).toBe(true);
    const jumps = [...hero.querySelectorAll<HTMLAnchorElement>("nav[aria-label='Position groups'] a")];
    expect(jumps.map((a) => a.getAttribute("href"))).toEqual(["#community", "#regions", "#projects"]);
    for (const a of jumps) expect([...a.classList]).toEqual(["btn", "btn--quiet"]);
  });

  it("ranks a seat's buttons: gold to apply, stone to email (#229)", () => {
    const apply = [...main.querySelectorAll("[data-position] a[data-apply]")];
    const email = [...main.querySelectorAll("[data-position] a[data-raise-hand]")];
    expect(apply.length).toBeGreaterThan(0);
    expect(email.length).toBeGreaterThan(0);
    for (const a of apply) expect([...a.classList]).toEqual(["btn", "btn--gold"]);
    for (const a of email) expect([...a.classList]).toEqual(["btn", "btn--stone"]);
  });

  it("links a filled seat to its holder on the Team page", () => {
    for (const position of positions.filter((p) => p.status === "filled")) {
      const card = page.querySelector(`[data-position='${position.id}']`);
      expect(card?.querySelector(`a[href='/team/#${position.holder}']`)).not.toBeNull();
    }
  });

  it("uses no paid or hiring wording, and says volunteer only on seats that take applications (decisions 44 and 67)", () => {
    expect(text(main)).not.toMatch(/\b(paid|pay|salary|stipend|hiring|hire|job|jobs)\b/i);
    const rest = main.cloneNode(true) as HTMLElement;
    for (const card of rest.querySelectorAll<HTMLElement>("[data-position]")) {
      const seat = positions.find((p) => p.id === card.dataset.position);
      if (seat && applying(seat)) card.remove();
    }
    expect(text(rest)).not.toMatch(/\bvolunteer\w*\b/i);
  });

  it("orders headings without skipping a level, and keeps ids unique", () => {
    headingLevelsStep(page);
    idsUnique(page);
  });

  it("passes axe (structure and ARIA)", async () => {
    expect(await axeViolations(source)).toEqual([]);
  });
});
