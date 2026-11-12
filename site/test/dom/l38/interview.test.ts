// L38 over the built site (run `npm run build` first; test:content does).
// The owner's rule 7 takes step 3 from roles.json: "If it looks like a fit,
// Paul sets up an interview". Two checks hold it:
//   - The matcher flags any sentence on a page under /get-involved/ that says
//     "interview with Paul" or "set up an interview" without "If it looks like
//     a fit". It reads only those two phrases, so each runs on a known-bad and
//     a known-clean sample first.
//   - The four lines that promised every applicant an interview before are
//     pinned word for word: the line under each seat card's apply button, the
//     "How to raise your hand" paragraph on /get-involved/, the form's step 3
//     and the thanks page. A deleted or reworded line fails here even when the
//     matcher passes.
import { describe, expect, it } from "vitest";

import { contentPages, readDist } from "../pages";

const CONDITIONAL = "If it looks like a fit, Paul sets up an interview.";
const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

const SENTENCE = /(?<=[.!?])\s+/;
const PROMISE = /\binterview(?:s|ed)? with Paul\b|\bset(?:s|ting)? up an interview\b/i;
const CONDITION = /\bif it looks like a fit\b/i;

/** Sentences in the visible text that say "interview with Paul" or "set up an interview" without "If it looks like a fit". */
function unconditionalInterviews(html: string): string[] {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const blocks = [...body.querySelectorAll("p, li, span, td, dd, h1, h2, h3, h4, figcaption, label")]
    .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((t) => PROMISE.test(t));
  return [...new Set(blocks.flatMap((t) => t.split(SENTENCE)))].filter((s) => PROMISE.test(s) && !CONDITION.test(s));
}

describe("unconditionalInterviews (self-test)", () => {
  it("flags the old wording (known bad)", () => {
    expect(unconditionalInterviews("<p>You take a few Claude Academy courses, then interview with Paul.</p>")).toEqual([
      "You take a few Claude Academy courses, then interview with Paul.",
    ]);
    expect(unconditionalInterviews("<ol><li>Interview with Paul.</li></ol>")).toEqual(["Interview with Paul."]);
  });

  it("flags set up an interview without the condition (known bad)", () => {
    expect(unconditionalInterviews("<p>Paul Foley reads every application. Next, he emails you to set up an interview.</p>")).toEqual([
      "Next, he emails you to set up an interview.",
    ]);
    expect(unconditionalInterviews("<p>Paul sets up an interview with each applicant.</p>")).toEqual([
      "Paul sets up an interview with each applicant.",
    ]);
  });

  it("passes set up an interview with the condition in the same sentence (known clean)", () => {
    expect(unconditionalInterviews("<p>Next, if it looks like a fit, he emails you to set up an interview.</p>")).toEqual([]);
    expect(unconditionalInterviews("<p>Send your badge links. If it looks like a fit, Paul sets up an interview, and you talk.</p>")).toEqual([]);
  });

  it("passes the new wording and a sentence with no promise (known clean)", () => {
    expect(unconditionalInterviews("<p>You take a few courses. If it looks like a fit, Paul sets up an interview.</p>")).toEqual([]);
    expect(unconditionalInterviews("<p>If it looks like a fit, you have an interview with Paul.</p>")).toEqual([]);
    expect(unconditionalInterviews("<h3>In the interview, Paul looks for</h3>")).toEqual([]);
  });
});

describe("every built page under /get-involved/", () => {
  const pages = contentPages().filter((p) => p.route.startsWith("/get-involved/"));

  it("includes the index, the form, the thanks page and the four seat pages", () => {
    expect(pages.length).toBeGreaterThanOrEqual(7);
  });

  it.each(pages.map((p) => [p.route, p.html] as const))("%s promises no interview without the condition", (_route, html) => {
    expect(unconditionalInterviews(html)).toEqual([]);
  });
});

describe("the four lines that used to promise an interview", () => {
  it("says the condition under the apply button on every card for a seat that takes applications", () => {
    const lines = contentPages().flatMap((p) =>
      [...doc(p.html).querySelectorAll("[data-position]")]
        .filter((card) => card.querySelector("a[data-apply]"))
        .map((card) => [`${p.route} ${card.getAttribute("data-position")}`, text(card.querySelector(".position__email-line"))] as const),
    );
    // Four seats on /get-involved/, plus /community/ and the three region pages.
    expect(lines.length).toBeGreaterThanOrEqual(7);
    // #146: the courses moved above the button, listed and timed; this line
    // now says who Paul is.
    for (const [where, line] of lines) expect(line, where).toBe(`Paul Foley, our founder, reads every application. ${CONDITIONAL}`);
  });

  it("says it in the How to raise your hand paragraph on /get-involved/", () => {
    const section = doc(readDist("get-involved/index.html")).getElementById("how-title")?.closest("section");
    expect(text(section?.querySelector("p"))).toBe(
      `Some seats take an application. Their "Apply for this seat" button opens a short form. First you finish the free Claude Academy courses the seat's card lists, each with its length. Paul Foley, our founder, reads every application. ${CONDITIONAL}`,
    );
  });

  it("says it as step 3 on the form", () => {
    const step = doc(readDist("get-involved/apply/index.html")).querySelector("ol.steps li:nth-child(3)");
    expect(text(step)).toBe(CONDITIONAL);
  });

  it("says it on the thanks page", () => {
    const main = doc(readDist("get-involved/apply/thanks/index.html")).querySelector("main");
    const line = [...(main?.querySelectorAll("p") ?? [])].map(text).find((t) => t.startsWith("Paul Foley reads every application."));
    expect(line).toBe(
      "Paul Foley reads every application. Next, if it looks like a fit, he emails you to set up an interview. We contact you about this seat only.",
    );
  });
});
