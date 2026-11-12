// L19 over the built site (run `npm run build` first; test:content does):
// /get-involved/apply/ renders the open seats and their courses from
// positions.yaml, the form posts the field names the Worker parses, the thanks
// page stays out of search, and /get-involved/ links the four seats here.
import { readFileSync } from "node:fs";
import path from "node:path";

import { comparePositions, COURSE_TITLES, PositionSchema, REQUIRED_COURSES, type ApplyRoleId } from "@cs/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { APPLY_FIELDS as F, BADGE_PATTERN, badgeField, LINKEDIN_PATTERN } from "../../../src/components/apply/fields";
import { UNPAID_VOLUNTEER_LINE } from "../../../src/components/positions/positions";
import { REGIONS } from "../../../src/lib/regions/match";
import { axeViolations } from "../l9/axe";
import { contentPages, readDist, SITE_DIR, sitemapPaths } from "../pages";

const positions = (parse(readFileSync(path.resolve(SITE_DIR, "..", "data", "team", "positions.yaml"), "utf8")) as unknown[]).map(
  (p) => PositionSchema.parse(p),
);
const seats = positions.filter((p) => p.status === "open" && p.apply?.open).sort(comparePositions(REGIONS));

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
// Decision 67: never these, on any seat. "Volunteer" is allowed for the four
// application seats, and "contributor" never names a seat.
const BARRED = /\b(paid|pay|salary|stipend|hiring|hire|job|jobs)\b/i;
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

function headingsStep(page: Document): void {
  const levels = [...page.querySelectorAll("main :is(h1, h2, h3, h4, h5, h6)")].map((h) => Number(h.tagName[1]));
  expect(levels[0]).toBe(1);
  for (let i = 1; i < levels.length; i += 1) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
}

describe("/get-involved/apply/", () => {
  const source = readDist("get-involved/apply/index.html");
  const page = doc(source);
  const main = page.querySelector("main")!;
  const formEl = page.querySelector<HTMLFormElement>("form[data-apply-form]")!;

  it("posts multipart to /api/apply", () => {
    expect(formEl.getAttribute("action")).toBe("/api/apply");
    expect(formEl.getAttribute("method")).toBe("post");
    expect(formEl.getAttribute("enctype")).toBe("multipart/form-data");
  });

  it("offers the four seats, in comparePositions() order, by title", () => {
    expect(seats.map((s) => s.id)).toEqual([
      "slack-community-lead",
      "photon-mountain-connector",
      "space-peak-connector",
      "fusion-canyon-connector",
    ]);
    const options = [...formEl.querySelectorAll<HTMLOptionElement>(`select[name='${F.role}'] option`)];
    expect(options.map((o) => o.value)).toEqual(["", ...seats.map((s) => s.id)]);
    expect(options.slice(1).map((o) => text(o))).toEqual(seats.map((s) => s.title));
    expect(formEl.querySelector(`select[name='${F.role}']`)?.hasAttribute("required")).toBe(true);
  });

  it("lists each seat with its summary before the form", () => {
    const items = [...main.querySelectorAll<HTMLElement>("[data-apply-seats] li")];
    expect(items.map((li) => li.dataset.seat)).toEqual(seats.map((s) => s.id));
    for (const [i, seat] of seats.entries()) expect(text(items[i])).toContain(seat.summary);
  });

  it("tags every course field with exactly the seats that need it", () => {
    const fields = [...formEl.querySelectorAll<HTMLElement>("[data-course]")];
    expect(fields.map((f) => f.dataset.course).sort()).toEqual(Object.keys(COURSE_TITLES).sort());
    for (const field of fields) {
      const course = field.dataset.course!;
      const want = seats.filter((s) => REQUIRED_COURSES[s.id as ApplyRoleId].includes(course as never)).map((s) => s.id);
      expect(field.dataset.roles?.split(" "), course).toEqual(want);
      const input = field.querySelector<HTMLInputElement>("input")!;
      expect(input.name).toBe(badgeField(course as never));
      expect(input.type).toBe("url");
      expect(input.getAttribute("pattern")).toBe(BADGE_PATTERN);
      // Required in the markup only when every seat needs it; the page script
      // requires the rest once a seat is chosen.
      expect(input.hasAttribute("required"), course).toBe(want.length === seats.length);
      expect(text(field.querySelector("label"))).toBe(`Badge link for ${COURSE_TITLES[course as never]}`);
    }
  });

  it("links every course to Claude Academy in a new tab, and says so", () => {
    for (const field of formEl.querySelectorAll<HTMLElement>("[data-course]")) {
      const link = field.querySelector<HTMLAnchorElement>("a")!;
      expect(link.getAttribute("href")).toBe(`https://academy.claude.com/courses/${field.dataset.course}`);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(text(link)).toContain("(opens in a new tab)");
    }
    const listed = [...main.querySelectorAll<HTMLElement>("[data-apply-courses] li")].map((li) => li.dataset.courseId);
    expect(listed.sort()).toEqual(Object.keys(COURSE_TITLES).sort());
  });

  it("asks for the applicant fields, with the caps the Worker enforces", () => {
    const field = (name: string) => formEl.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name='${name}']`)!;
    for (const name of [F.name, F.email, F.basedIn, F.why]) expect(field(name).hasAttribute("required"), name).toBe(true);
    for (const name of [F.linkedin, F.anythingElse]) expect(field(name).hasAttribute("required"), name).toBe(false);
    expect(field(F.email).getAttribute("type")).toBe("email");
    // #138: type="text", so a profile typed without https:// is not blocked.
    expect(field(F.linkedin).getAttribute("type")).toBe("text");
    expect(field(F.linkedin).getAttribute("inputmode")).toBe("url");
    expect(field(F.linkedin).getAttribute("autocomplete")).toBe("url");
    expect(field(F.linkedin).getAttribute("pattern")).toBe(LINKEDIN_PATTERN);
    expect(field(F.why).getAttribute("maxlength")).toBe("1500");
    expect(field(F.anythingElse).getAttribute("maxlength")).toBe("1000");
    expect(text(page.querySelector("label[for='ap-why']"))).toBe("Why are you excited about this seat?");
  });

  it("requires the consent box, worded as contact about this seat only", () => {
    const box = formEl.querySelector<HTMLInputElement>(`input[name='${F.consent}']`)!;
    expect(box.type).toBe("checkbox");
    expect(box.hasAttribute("required")).toBe(true);
    expect(text(page.querySelector(`label[for='${box.id}']`))).toBe("Colorado Startups will contact me about this seat only.");
  });

  it("labels every visible control", () => {
    const controls = [...formEl.querySelectorAll<HTMLElement>("input:not([type='hidden']), select, textarea")].filter(
      (el) => !el.closest(".hp") && !el.closest(".cf-turnstile"),
    );
    for (const el of controls) expect(page.querySelector(`label[for='${el.id}']`), el.getAttribute("name") ?? "").not.toBeNull();
  });

  it("carries the speed stamp, the honeypot and the Turnstile widget", () => {
    expect(formEl.querySelector("input[type='hidden'][name='ts'][data-load-stamp]")).not.toBeNull();
    const hp = formEl.querySelector(".hp[aria-hidden='true'] input[name='website']");
    expect(hp?.getAttribute("tabindex")).toBe("-1");
    expect(formEl.querySelector(".cf-turnstile")?.hasAttribute("data-sitekey")).toBe(true);
    // #121: the script loads when the visitor starts on the form, not with the page.
    expect(formEl.querySelector(".cf-turnstile")?.hasAttribute("data-turnstile-lazy")).toBe(true);
    expect(text(formEl.querySelector("button[type='submit']"))).toBe("Send my application");
  });

  it("tells a visitor without JavaScript to apply by email instead", () => {
    const note = page.querySelector(".apply noscript");
    expect(note).not.toBeNull();
    // jsdom parses <noscript> content as text when scripting is on.
    const body = (note?.textContent ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(body).toContain("needs JavaScript");
    expect(body).toContain("info@coloradostartups.org");
    expect(note!.compareDocumentPosition(formEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("has a hidden message for each error code the Worker sends", () => {
    const codes = [...page.querySelectorAll<HTMLElement>("[data-error]")].map((e) => e.dataset.error);
    expect(codes.sort()).toEqual(["delivery", "invalid", "ratelimit", "unavailable", "verification"]);
    for (const el of page.querySelectorAll<HTMLElement>("[data-error]")) expect(el.hidden).toBe(true);
  });

  it("states how we use the application before the first field", () => {
    const purpose = main.querySelector("section.purpose")!;
    expect(text(purpose)).toContain("only to consider you for the seat you choose");
    expect(text(purpose)).toContain("never visits them");
    expect(text(purpose)).toContain("delete your name, contact details and answers");
    expect(purpose.compareDocumentPosition(formEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says the unpaid volunteer line once, beside the seat picker, and nothing barred (decision 67)", () => {
    expect(UNPAID_VOLUNTEER_LINE).toBe("An unpaid volunteer role.");
    expect(count(text(main), UNPAID_VOLUNTEER_LINE)).toBe(1);
    const hint = page.querySelector<HTMLElement>("[data-unpaid-line]");
    expect(hint?.id).toBe(formEl.querySelector(`select[name='${F.role}']`)?.getAttribute("aria-describedby"));
    expect(text(main)).not.toMatch(BARRED);
    expect(text(main)).not.toMatch(/contributor/i);
  });

  it("leads with what a seat gives, before how it works", () => {
    const h2s = [...main.querySelectorAll("h2")].map((h) => text(h));
    expect(h2s.slice(0, 2)).toEqual(["What a seat gives you", "How it works"]);
    expect(text(main)).toContain("on LinkedIn");
  });

  it("orders headings without skipping a level, keeps ids unique, and is in the sitemap", () => {
    headingsStep(page);
    const ids = [...page.querySelectorAll("[id]")].map((e) => e.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    expect(sitemapPaths()).toContain("/get-involved/apply/");
  });

  it("passes axe (structure and ARIA)", async () => {
    expect(await axeViolations(source)).toEqual([]);
  });
});

describe("/get-involved/apply/thanks/", () => {
  const source = readDist("get-involved/apply/thanks/index.html");
  const page = doc(source);

  it("thanks the applicant, names the interview, and stays out of search", () => {
    expect(text(page.querySelector("h1"))).toBe("Thank you");
    expect(text(page.querySelector("main"))).toContain("set up an interview");
    expect(text(page.querySelector("main"))).not.toMatch(BARRED);
    expect(page.querySelector("meta[name='robots']")?.getAttribute("content")).toBe("noindex");
    expect(sitemapPaths()).not.toContain("/get-involved/apply/thanks/");
  });

  it("passes axe (structure and ARIA)", async () => {
    expect(await axeViolations(source)).toEqual([]);
  });
});

describe("/get-involved/ sends the four seats to the form", () => {
  const page = doc(readDist("get-involved/index.html"));

  it("links exactly the open apply seats, each with its id, and leaves every other seat on email", () => {
    const applyLinks = [...page.querySelectorAll<HTMLAnchorElement>("[data-position] a[data-apply]")];
    expect(applyLinks.map((a) => a.getAttribute("href")).sort()).toEqual(
      seats.map((s) => `/get-involved/apply/?role=${s.id}`).sort(),
    );
    const others = positions.filter((p) => p.status === "open" && !seats.includes(p));
    for (const p of others) {
      const href = page.querySelector(`[data-position='${p.id}'] a[data-raise-hand]`)?.getAttribute("href") ?? "";
      expect(href, p.id).toMatch(/^mailto:info@coloradostartups\.org\?/);
    }
  });
});

// Decision 67 reaches the page head too: titles, descriptions and the Open
// Graph tags that a shared link shows. "Volunteer" lives only in the one
// visible line, never in the head.
describe("the head of every page that shows these seats", () => {
  for (const file of ["get-involved/apply/index.html", "get-involved/apply/thanks/index.html", "get-involved/index.html"]) {
    it(`${file} keeps volunteer, contributor and barred words out of its title and meta tags`, () => {
      const head = doc(readDist(file)).head;
      const texts = [
        text(head.querySelector("title")),
        ...[...head.querySelectorAll("meta[content]")]
          .filter((m) => /description|title/.test(m.getAttribute("name") ?? m.getAttribute("property") ?? ""))
          .map((m) => m.getAttribute("content") ?? ""),
      ];
      expect(texts.length).toBeGreaterThanOrEqual(3);
      for (const t of texts) {
        expect(t, file).not.toMatch(/volunteer|contributor/i);
        expect(t, file).not.toMatch(BARRED);
      }
    });
  }
});

// Decision 67: the line appears on every seat that takes applications,
// wherever its card renders (/get-involved/, /community/, region pages).
describe("every built card for a seat that takes applications", () => {
  const ids = new Set(seats.map((s) => s.id));
  const cards = contentPages().flatMap((p) =>
    [...doc(p.html).querySelectorAll<HTMLElement>("[data-position]")]
      .filter((card) => ids.has(card.dataset.position ?? ""))
      .map((card) => [`${p.route} ${card.dataset.position}`, card] as const),
  );

  it("renders on at least /get-involved/ and each region page", () => {
    expect(cards.length).toBeGreaterThanOrEqual(seats.length + 3);
  });

  it.each(cards)("%s says the line once, after what the seat gives, links to the form, and never says contributor", (_label, card) => {
    expect(count(text(card), UNPAID_VOLUNTEER_LINE)).toBe(1);
    const line = card.querySelector("[data-unpaid-line]");
    const seat = seats.find((s) => s.id === card.dataset.position)!;
    expect(text(line)).toBe(UNPAID_VOLUNTEER_LINE);
    expect(text(line?.previousElementSibling)).toBe(seat.summary);
    expect(card.querySelector("a[data-apply]")?.getAttribute("href")).toBe(`/get-involved/apply/?role=${card.dataset.position}`);
    expect(text(card)).not.toMatch(/contributor/i);
    expect(text(card)).not.toMatch(BARRED);
  });
});

describe("/privacy/ covers applications", () => {
  it("renders the Applications section from data/legal/privacy.md", () => {
    const main = doc(readDist("privacy/index.html")).querySelector("main");
    expect(text(main)).toContain("The seat application form");
    expect(text(main)).toContain("The site stores your links as text and never visits them.");
  });
});
