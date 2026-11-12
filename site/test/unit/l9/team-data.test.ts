// L9: the Team and positions data agree with each other, and the
// seat email is built the same way everywhere.
import { existsSync, readFileSync } from "node:fs";

import { PersonSchema, PositionSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  AREA_ORDER,
  groupByArea,
  holderOf,
  RAISE_HAND_EMAIL,
  raiseHandHref,
  raiseHandSubject,
  takesApplications,
  UNPAID_VOLUNTEER_LINE,
} from "../../../src/components/positions/positions";
import { ON_FIXTURES } from "../../people-source";

const DATA = new URL("../../../../data/team/", import.meta.url);
const PHOTOS = new URL("../../../src/components/team/photos/", import.meta.url);
const read = (file: string) => parse(readFileSync(new URL(file, DATA), "utf8")) as unknown[];

const people = read("people.yaml").map((p) => PersonSchema.parse(p));
const positions = read("positions.yaml").map((p) => PositionSchema.parse(p));

describe("people.yaml", () => {
  // These three name real people, so they skip on fixtures (the public repo).
  it.skipIf(ON_FIXTURES)("has Paul as the one leader, Founder & President", () => {
    const leaders = people.filter((p) => p.group === "leadership");
    expect(leaders.map((p) => [p.id, p.title])).toEqual([["paul-foley", "Founder & President"]]);
  });

  it.skipIf(ON_FIXTURES)("keeps investing out of Paul's bio (lane file L9)", () => {
    const paul = people.find((p) => p.id === "paul-foley");
    expect(paul?.bio).not.toMatch(/invest|fund|capital|portfolio/i);
  });

  it.skipIf(ON_FIXTURES)("keeps Ryan as a volunteer and Micah and Lindsey under with thanks (decision 19)", () => {
    expect(people.find((p) => p.id === "ryan-shuken")?.group).toBe("volunteers");
    expect(people.filter((p) => p.group === "with-thanks").map((p) => p.id)).toEqual(["micah-mador", "lindsey-rohde"]);
  });

  it("gives every person a unique id and a photo file that exists", () => {
    expect(new Set(people.map((p) => p.id)).size).toBe(people.length);
    for (const p of people.filter((x) => x.photo)) {
      const found = ["webp", "png", "jpg"].some((ext) => existsSync(new URL(`${p.photo}.${ext}`, PHOTOS)));
      expect(found, `${p.id}: photos/${p.photo}.*`).toBe(true);
    }
  });
});

describe("positions.yaml and people.yaml agree", () => {
  it("names a community-group person as the holder of every filled seat", () => {
    for (const seat of positions.filter((p) => p.status === "filled")) {
      const holder = holderOf(seat, people);
      expect(holder, `${seat.id} holder ${seat.holder}`).toBeDefined();
      expect(holder?.group).toBe("community");
    }
  });

  it("seats every community-group person in exactly one filled position", () => {
    for (const person of people.filter((p) => p.group === "community")) {
      expect(positions.filter((s) => s.holder === person.id), person.id).toHaveLength(1);
    }
  });

  // Decisions 44 and 67. Every seat bans the pay and hiring words. A seat that
  // takes applications carries UNPAID_VOLUNTEER_LINE on its card and may say
  // "volunteer" only inside that line; every other seat keeps the full ban.
  it("uses no paid or hiring wording, and says volunteer only in the plain line of an apply seat", () => {
    expect(UNPAID_VOLUNTEER_LINE).toBe("An unpaid volunteer role.");
    for (const seat of positions) {
      const card = [seat.title, seat.summary, ...seat.what_you_do, ...(takesApplications(seat) ? [UNPAID_VOLUNTEER_LINE] : [])];
      const text = card.join(" ");
      expect(text, seat.id).not.toMatch(/\b(paid|pay|salary|stipend|hiring|hire|job|jobs)\b/i);
      const outsideLine = takesApplications(seat) ? text.replaceAll(UNPAID_VOLUNTEER_LINE, "") : text;
      expect(outsideLine, seat.id).not.toMatch(/\bvolunteer\w*/i);
    }
  });

  it("leads each apply seat's summary with what the seat gives (decision 67)", () => {
    for (const seat of positions.filter(takesApplications)) {
      expect(seat.summary, seat.id).toMatch(/^Meet /);
      expect(seat.summary, seat.id).toContain(`carry the ${seat.title} title on LinkedIn`);
    }
  });
});

describe("groupByArea", () => {
  it("groups community, regions, projects in that order with stable anchors", () => {
    const groups = groupByArea(positions);
    expect(groups.map((g) => g.area)).toEqual([...AREA_ORDER]);
    expect(groups.map((g) => g.anchor)).toEqual(["community", "regions", "projects"]);
    expect(groups.flatMap((g) => g.positions)).toHaveLength(positions.length);
  });

  it("drops a group with no positions", () => {
    const onlyProjects = positions.filter((p) => p.area === "project");
    expect(groupByArea(onlyProjects).map((g) => g.area)).toEqual(["project"]);
  });
});

describe("raiseHandHref", () => {
  const seat = { title: "Startupers contributor" };
  const href = raiseHandHref(seat);
  const url = new URL(href);

  it("mails info@ with the seat in the subject", () => {
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe(RAISE_HAND_EMAIL);
    expect(decodeURIComponent(url.searchParams.get("subject") ?? "")).toBe(raiseHandSubject(seat));
    expect(raiseHandSubject(seat)).toContain("Startupers contributor");
  });

  it("encodes spaces as %20, never +, because mail clients read + literally", () => {
    expect(href).not.toContain("+");
    expect(href).toContain("Raise%20my%20hand%3A%20Startupers%20contributor");
  });

  it("breaks body lines with CRLF, encoded %0D%0A (RFC 6068)", () => {
    const body = href.split("&body=")[1] ?? "";
    expect(body).toContain("%0D%0A");
    expect(body.replaceAll("%0D%0A", "")).not.toMatch(/%0A|%0D/);
  });

  it("returns no holder for an open seat", () => {
    const open = positions.find((p) => p.status === "open");
    if (open) expect(holderOf(open, people)).toBeUndefined();
  });
});
