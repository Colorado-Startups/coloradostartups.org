// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://coloradostartups.org/ask/" }
//
// M1c: the Resourcus panel's events (src/components/resourcus/panel.ts). An
// answer sends ask_used, kind "resourcus"; each card link carries a
// resource_out mark for the click listener; the keyword search sends
// search_used with its hit count. Never the question. track() and Pagefind
// are mocked, and /api/ask is a stubbed fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initResourcusPanels } from "../../../src/components/resourcus/panel";
import { track } from "../../../src/lib/track";
import { shortSlug } from "../../../src/lib/track-attrs";

vi.mock("../../../src/lib/track", () => ({ track: vi.fn(() => true) }));
vi.mock("../../../src/lib/pagefind", () => ({
  loadPagefind: async () => ({
    search: async () => ({
      results: [
        { data: async () => ({ url: "/guides/startup-credits/", meta: { title: "Startup credits" } }) },
        { data: async () => ({ url: "/ecosystem-canvas/", meta: { title: "Startup Resources" } }) },
      ],
    }),
  }),
}));

const LONG_ID = "entrepreneurial-law-clinic-the-university-of-colorado-law-school-in-boulder";
const QUESTION = "Where can I get free legal help?";

function answer(mode: "model" | "fallback", withCards: boolean) {
  return {
    answer: "Try the law clinic.",
    citations: [],
    resources: withCards
      ? [
          {
            id: LONG_ID,
            name: "Entrepreneurial Law Clinic",
            url: "https://law.example.org/clinic",
            stage: "launch",
            substage: "service-providers",
            city: "Boulder",
            type: "service-provider",
            description: "Free legal help for founders.",
          },
        ]
      : [],
    mode,
    reason: "ok",
  };
}

function panel(): HTMLElement {
  document.body.innerHTML = `
    <section data-resourcus data-compact="false" data-sitekey="">
      <div data-thread></div>
      <form data-form><textarea></textarea><div data-turnstile></div><button type="submit" data-submit>Ask</button></form>
      <p data-status></p>
    </section>`;
  initResourcusPanels();
  return document.querySelector<HTMLElement>("[data-resourcus]")!;
}

async function ask(root: HTMLElement): Promise<void> {
  root.querySelector("textarea")!.value = QUESTION;
  root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(root.querySelector(".resourcus__turn")).not.toBeNull());
}

beforeEach(() => {
  vi.mocked(track).mockClear();
  // jsdom lays nothing out; the panel scrolls each answer into view.
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => vi.unstubAllGlobals());

describe("the Resourcus panel's events", () => {
  it("sends ask_used with kind resourcus for an answer, and marks each card link resource_out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(answer("model", true))));
    const root = panel();
    await ask(root);
    expect(track).toHaveBeenCalledWith("ask_used", { where: "ask-resourcus", kind: "resourcus" });
    const link = root.querySelector<HTMLAnchorElement>(".resourcus__card a")!;
    expect(link.dataset.track).toBe("resource_out");
    expect(link.dataset.trackWhere).toBe("ask-resourcus");
    expect(link.dataset.trackResource).toBe(shortSlug(LONG_ID));
    expect(link.dataset.trackResource!.length).toBeLessThanOrEqual(40);
    expect(JSON.stringify(vi.mocked(track).mock.calls)).not.toContain("legal");
  });

  it("sends search_used with the hit count when the visitor runs the keyword search", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(answer("fallback", false))));
    const root = panel();
    await ask(root);
    root.querySelector<HTMLButtonElement>(".resourcus__search button")!.click();
    await vi.waitFor(() => expect(track).toHaveBeenCalledWith("search_used", { where: "ask-resourcus", results: 2 }));
    expect(JSON.stringify(vi.mocked(track).mock.calls)).not.toContain("legal");
  });

  it("sends nothing when Resourcus cannot answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 429 })));
    const root = panel();
    root.querySelector("textarea")!.value = QUESTION;
    root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(root.querySelector("[data-status]")!.textContent).toContain("quickly"));
    expect(track).not.toHaveBeenCalled();
  });
});
