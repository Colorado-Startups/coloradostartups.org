// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://coloradostartups.org/" }
//
// M1b: the page-side track helper (src/lib/track.ts) and the one event list
// it shares with POST /api/e (packages/shared/src/events.ts).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as sharedIndex from "@cs/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as sharedEvents from "../../../../packages/shared/src/events";
import {
  canSend,
  eventFor,
  install,
  isLiveHost,
  onClick,
  onSubmit,
  track,
  TRACK_CONTENT_TYPE,
  TRACK_PATH,
} from "../../../src/lib/track";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(SITE, rel), "utf8");

type Beacon = (url: string, data: Blob) => boolean;

// Sets a navigator or window property for one test; restored in afterEach.
const restores: (() => void)[] = [];
function setProp(target: object, key: string, value: unknown): void {
  const had = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
  restores.push(() => (had ? Object.defineProperty(target, key, had) : delete (target as Record<string, unknown>)[key]));
}

let beacon: ReturnType<typeof vi.fn<Beacon>>;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("PROD", true);
  beacon = vi.fn<Beacon>(() => true);
  setProp(navigator, "sendBeacon", beacon);
  fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  while (restores.length) restores.pop()!();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function sentBody(call = 0): Promise<unknown> {
  const blob = beacon.mock.calls[call][1];
  return JSON.parse(await blob.text());
}

describe("track", () => {
  it("posts one event to /api/e by sendBeacon, as text/plain JSON", async () => {
    expect(track("door_pick", { where: "home", door: "founder" })).toBe(true);
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0];
    expect(url).toBe("/api/e");
    expect(TRACK_PATH).toBe("/api/e");
    expect(blob.type).toBe(TRACK_CONTENT_TYPE.toLowerCase());
    expect(await sentBody()).toEqual({ name: "door_pick", props: { where: "home", door: "founder" } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a name off the list, and drops props and values the event does not allow", async () => {
    expect(track("page_view")).toBe(false);
    expect(track("")).toBe(false);
    expect(track("constructor")).toBe(false);
    expect(beacon).not.toHaveBeenCalled();

    track("search_used", { where: "nav", results: 3, query: "my-co", $ip: "1.2.3.4" } as Record<string, string | number>);
    expect(await sentBody(0)).toEqual({ name: "search_used", props: { where: "nav", results: 3 } });
    track("join_click", { where: "a@b.example" });
    expect(await sentBody(1)).toEqual({ name: "join_click", props: {} });
    track("join_click", { where: "home?x=1" });
    expect(await sentBody(2)).toEqual({ name: "join_click", props: {} });
  });

  it("sends nothing under Global Privacy Control", () => {
    setProp(navigator, "globalPrivacyControl", true);
    expect(canSend()).toBe(false);
    expect(track("join_click", { where: "home" })).toBe(false);
    expect(beacon).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends nothing under Do Not Track, from navigator or window", () => {
    setProp(navigator, "doNotTrack", "1");
    expect(track("join_click")).toBe(false);
    restores.pop()!();
    setProp(window, "doNotTrack", "1");
    expect(track("join_click")).toBe(false);
    expect(beacon).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still sends when DNT is unset or 0 and GPC is false", () => {
    setProp(navigator, "doNotTrack", "0");
    setProp(navigator, "globalPrivacyControl", false);
    expect(track("join_click")).toBe(true);
  });

  it("sends nothing outside a production build", () => {
    vi.stubEnv("PROD", false);
    expect(track("join_click", { where: "home" })).toBe(false);
    expect(beacon).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends only from the two production hosts", () => {
    const silent = [
      "localhost",
      "127.0.0.1",
      "[::1]",
      "site.localhost",
      "cs.test",
      "coloradostartups-site.paul.workers.dev",
      "coloradostartups.pages.dev",
      "abc123.coloradostartups.pages.dev",
      "staging.coloradostartups.org",
      "coloradostartups.org.example",
    ];
    for (const host of silent) expect(isLiveHost(host), host).toBe(false);
    for (const host of ["coloradostartups.org", "www.coloradostartups.org", "WWW.ColoradoStartups.org"]) {
      expect(isLiveHost(host), host).toBe(true);
    }
  });

  it("is silent on a preview or staging deploy and sends on production, end to end", () => {
    for (const [host, sends] of [
      ["coloradostartups-site.paul.workers.dev", false],
      ["coloradostartups.pages.dev", false],
      ["staging.coloradostartups.org", false],
      ["coloradostartups.org", true],
      ["www.coloradostartups.org", true],
    ] as const) {
      setProp(window, "location", { hostname: host });
      beacon.mockClear();
      expect(track("join_click", { where: "home" }), host).toBe(sends);
      expect(beacon.mock.calls.length, host).toBe(sends ? 1 : 0);
      restores.pop()!();
    }
  });

  it("falls back to fetch with keepalive when sendBeacon is missing or returns false", async () => {
    for (const setup of [() => setProp(navigator, "sendBeacon", undefined), () => beacon.mockReturnValue(false)]) {
      setup();
      fetchSpy.mockClear();
      expect(track("step_done", { where: "join", step: "slack" })).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/e");
      expect(init).toMatchObject({ method: "POST", keepalive: true, credentials: "omit" });
      expect(init.headers).toEqual({ "Content-Type": TRACK_CONTENT_TYPE });
      expect(JSON.parse(init.body as string)).toEqual({ name: "step_done", props: { where: "join", step: "slack" } });
    }
  });

  it("never throws into the page", async () => {
    beacon.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => track("join_click")).not.toThrow();
    expect(track("join_click")).toBe(false);

    setProp(navigator, "sendBeacon", undefined);
    fetchSpy.mockImplementation(() => Promise.reject(new TypeError("offline")));
    expect(() => track("join_click")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // a rejected fetch stays caught

    fetchSpy.mockImplementation(() => {
      throw new TypeError("sync");
    });
    expect(track("join_click")).toBe(false);
  });

  it("sets and reads no cookie and no storage", () => {
    const cookie = vi.spyOn(document, "cookie", "get");
    const setCookie = vi.spyOn(document, "cookie", "set");
    const local = vi.spyOn(Storage.prototype, "getItem");
    const store = vi.spyOn(Storage.prototype, "setItem");
    document.body.innerHTML = `<button data-track="join_click" data-track-where="home">Join</button>`;
    install();
    document.querySelector("button")!.click();
    track("door_pick", { where: "home", door: "founder" });
    for (const spy of [cookie, setCookie, local, store]) expect(spy).not.toHaveBeenCalled();
    const source = read("src/lib/track.ts");
    expect(source).not.toMatch(/document\.cookie|localStorage|sessionStorage|indexedDB|crypto\./);
  });
});

describe("click delegation", () => {
  it("reads data-track and the props the event allows from the clicked element or its ancestor", () => {
    document.body.innerHTML = `
      <a href="#x" data-track="door_pick" data-track-where="home" data-track-door="founder" data-track-region="x">
        <span id="inner">Founder</span>
      </a>
      <button id="search" data-track="search_used" data-track-where="nav" data-track-results="4">Go</button>
      <button id="ok" data-track="join_submit" data-track-where="join" data-track-ok="false">Send</button>
      <button id="typo" data-track="join_clik">Join</button>
      <button id="email" data-track="join_click" data-track-where="a@b.example">Join</button>
      <p id="plain">No mark</p>`;
    expect(eventFor(document.getElementById("inner"))).toEqual({ name: "door_pick", props: { where: "home", door: "founder" } });
    expect(eventFor(document.getElementById("search"))).toEqual({ name: "search_used", props: { where: "nav", results: 4 } });
    expect(eventFor(document.getElementById("ok"))).toEqual({ name: "join_submit", props: { where: "join", ok: false } });
    expect(eventFor(document.getElementById("typo"))).toBeNull();
    expect(eventFor(document.getElementById("email"))).toEqual({ name: "join_click", props: {} });
    expect(eventFor(document.getElementById("plain"))).toBeNull();
    expect(eventFor(null)).toBeNull();
    expect(eventFor(window)).toBeNull();
  });

  it("sends one event per marked click through one document listener, and nothing for other clicks", async () => {
    document.body.innerHTML = `
      <button id="a" data-track="connect_click" data-track-where="footer" data-track-target="slack">Slack</button>
      <button id="b">Plain</button>`;
    install();
    install(); // a second call adds no second listener
    document.getElementById("b")!.click();
    expect(beacon).not.toHaveBeenCalled();
    const a = document.getElementById("a")!;
    a.addEventListener("click", (e) => e.stopPropagation());
    a.click();
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(await sentBody()).toEqual({ name: "connect_click", props: { where: "footer", target: "slack" } });
  });

  it("onClick never throws, even for an odd event", () => {
    expect(() => onClick(new Event("click"))).not.toThrow();
    expect(() => onClick({ target: {} } as unknown as Event)).not.toThrow();
  });

  // The Ask dialog's and home's Search buttons (AskDialog.astro, Ask.astro).
  it("counts a marked submit button when its form submits, and not for a submit the browser refuses", async () => {
    document.body.innerHTML = `
      <form id="ask" action="/ask/" method="get">
        <input id="q" name="q" type="search" required />
        <button id="go" type="submit" data-track="ask_used" data-track-where="ask-dialog" data-track-kind="search">Search</button>
      </form>`;
    install();
    const form = document.getElementById("ask") as HTMLFormElement;
    // jsdom cannot navigate: each accepted submit stops after the listener saw it.
    form.addEventListener("submit", (e) => e.preventDefault());
    const go = document.getElementById("go") as HTMLButtonElement;
    // The required box is empty: the click fires, the browser refuses the submit.
    go.click();
    expect(beacon).not.toHaveBeenCalled();
    (document.getElementById("q") as HTMLInputElement).value = "coworking";
    go.click();
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(await sentBody()).toEqual({ name: "ask_used", props: { where: "ask-dialog", kind: "search" } });
    // Enter in the box submits by the same button, and counts once more.
    form.requestSubmit(go);
    expect(beacon).toHaveBeenCalledTimes(2);
    // A submit by no marked button sends nothing.
    form.requestSubmit();
    expect(beacon).toHaveBeenCalledTimes(2);
  });

  it("onSubmit never throws, even for an odd event", () => {
    expect(() => onSubmit(new Event("submit"))).not.toThrow();
    expect(() => onSubmit({ submitter: {} } as unknown as Event)).not.toThrow();
  });
});

describe("one event list for the site and the Worker", () => {
  it("the package index and the file track.ts loads are the same list", () => {
    expect(sharedIndex.EVENT_PROPS).toBe(sharedEvents.EVENT_PROPS);
    expect(sharedIndex.cleanProps).toBe(sharedEvents.cleanProps);
    expect(sharedEvents.EVENT_NAMES).toHaveLength(12);
  });

  it("track.ts and worker/routes/e.ts both import it, and neither keeps a list of its own", () => {
    const trackSrc = read("src/lib/track.ts");
    const routeSrc = read("worker/routes/e.ts");
    expect(trackSrc).toMatch(/from "\.\.\/\.\.\/\.\.\/packages\/shared\/src\/events"/);
    expect(path.resolve(SITE, "src/lib", "../../../packages/shared/src/events.ts")).toBe(
      path.resolve(SITE, "../packages/shared/src/events.ts"),
    );
    expect(routeSrc).toMatch(/import \{[^}]*\bisEventName\b[^}]*\} from "@cs\/shared"/);
    expect(routeSrc).toMatch(/import \{[^}]*\bcleanProps\b[^}]*\} from "@cs\/shared"/);
    for (const name of sharedEvents.EVENT_NAMES) {
      expect(trackSrc, `track.ts names ${name} itself`).not.toContain(name);
      expect(routeSrc, `e.ts names ${name} itself`).not.toContain(name);
    }
    expect(routeSrc).not.toMatch(/\[a-z0-9_-\]/);
  });

  it("the privacy policy's click-event promises match the code", () => {
    const policy = read("../data/legal/privacy.md");
    const route = read("worker/routes/e.ts");
    const helper = read("src/lib/track.ts");
    expect(policy).toContain("If your browser sends Global Privacy Control or Do Not Track, the site sends no click events at all.");
    // Nothing is marked data-track yet, so the policy says buttons can record a click, not that they do.
    expect(policy).toContain("Some buttons, such as a join button, can record a click as an anonymous event. When they do,");
    expect(policy).toContain("The policy now also describes click events, which some buttons can record");
    expect(policy).not.toMatch(/the site records the click|We also added click events/);
    expect(helper).toContain("globalPrivacyControl");
    expect(helper).toContain("doNotTrack");
    expect(policy).toContain("up to two short labels");
    for (const keys of Object.values(sharedEvents.EVENT_PROPS)) expect(keys.length).toBeLessThanOrEqual(2);
    expect(policy).toContain("| PostHog |");
    expect(route).toContain("$process_person_profile: false");
    expect(route).not.toMatch(/Set-Cookie/i);
  });

  it("keeps the shared file free of imports, so the page bundle stays small", () => {
    expect(read("../packages/shared/src/events.ts")).not.toMatch(/^import /m);
  });
});
