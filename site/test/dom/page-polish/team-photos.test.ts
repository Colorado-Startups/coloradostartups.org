// Page polish, #256, over the built site (run `npm run build` first;
// test:content does). Every person photo on /team/ sits in the round frame
// that carries the ring, and only a photo with a crop in photo-crops.ts gets
// the zoom. The CSS side is in test/unit/page-polish/photo-crops.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";

import { PersonSchema } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { photoCropStyle } from "../../../src/components/team/photo-crops";
import { readDist, SITE_DIR } from "../pages";
import { ON_FIXTURES } from "../../people-source";

const people = (parse(readFileSync(path.resolve(SITE_DIR, "..", "data", "team", "people.yaml"), "utf8")) as unknown[]).map(
  (p) => PersonSchema.parse(p),
);
const page = new DOMParser().parseFromString(readDist("team/index.html"), "text/html");

describe("/team/ person photos (#256)", () => {
  const withPhotos = people.filter((p) => p.photo);

  it("has people with photos", () => {
    expect(withPhotos.length).toBeGreaterThan(0);
  });

  for (const person of withPhotos) {
    it(`${person.id}: sits in the ring frame, zoomed only when photo-crops.ts crops it`, () => {
      const img = page.querySelector(`[data-person='${person.id}'] img`);
      const frame = img?.parentElement;
      expect(frame?.classList.contains("person__frame")).toBe(true);
      expect(frame?.getAttribute("style") ?? undefined).toBe(photoCropStyle(person.photo));
    });
  }

  // These two name a real photo, so they skip on fixtures (the public repo).
  it.skipIf(ON_FIXTURES)("zooms Lindsey's full-length photo to head and shoulders", () => {
    const frame = page.querySelector("[data-person='lindsey-rohde'] .person__frame");
    expect(frame?.getAttribute("style")).toMatch(/--photo-zoom:\s*1\.\d+/);
  });

  // The largest file width each photo offers in its srcset.
  const widest = (id: string) =>
    Math.max(
      ...(page.querySelector(`[data-person='${id}'] img`)?.getAttribute("srcset") ?? "")
        .split(",")
        .map((c) => Number(/\s(\d+)w$/.exec(c.trim())?.[1] ?? 0)),
    );

  it.skipIf(ON_FIXTURES)("gives the zoomed photo wider files, so its crop stays sharp on a 2x screen", () => {
    expect(widest("lindsey-rohde")).toBe(640);
    for (const person of withPhotos.filter((p) => !photoCropStyle(p.photo))) expect(widest(person.id), person.id).toBe(352);
  });
});
