// @vitest-environment jsdom
// Step W8: the visitor's region, kept on this device only (lib/your-region.ts).
// A real region id is saved and read back, any other value is ignored,
// storage that throws (blocked site data, a private window) never throws out,
// and clear forgets the pick. Then the two islands that use it, on small
// fixtures: the header slot (region-slot.ts) and home's This week strip
// (this-week.ts). test/dom/header/your-region.test.ts checks the built pages.
import { REGION_IDS } from "@cs/shared";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { initRegionFirst } from "../../src/components/events/this-week";
import { initRegionSlot } from "../../src/components/ui/header/region-slot";
import {
  clearRegion,
  deviceStore,
  parseRegion,
  readRegion,
  type RegionStore,
  saveRegion,
  YOUR_REGION_EVENT,
  YOUR_REGION_KEY,
} from "../../src/lib/your-region";

/** An in-memory store, as localStorage behaves. */
function memory(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const store: RegionStore = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
  return { store, data };
}

/** A store that throws on every call, as blocked site data does. */
const blocked: RegionStore = {
  getItem: () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  },
  removeItem: () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  },
};

describe("the pick on this device", () => {
  it("saves a real region id and reads it back", () => {
    const { store, data } = memory();
    for (const id of REGION_IDS) {
      expect(saveRegion(store, id, REGION_IDS)).toBe(true);
      expect(data.get(YOUR_REGION_KEY)).toBe(id);
      expect(readRegion(store, REGION_IDS)).toBe(id);
    }
  });

  it("ignores an id that is not a real region, on save and on read", () => {
    const { store, data } = memory();
    for (const bad of ["outpost", "Photon Mountain", "", " photon-mountain", "__proto__"]) {
      expect(parseRegion(bad, REGION_IDS)).toBeNull();
      expect(saveRegion(store, bad, REGION_IDS)).toBe(false);
    }
    expect(data.size).toBe(0);
    // A value saved by an older page, or typed into devtools, reads as no pick.
    expect(readRegion(memory({ [YOUR_REGION_KEY]: "hq" }).store, REGION_IDS)).toBeNull();
    expect(parseRegion(42, REGION_IDS)).toBeNull();
    expect(parseRegion(null, REGION_IDS)).toBeNull();
  });

  it("never throws when storage throws, and then acts as if nothing was picked", () => {
    expect(() => readRegion(blocked, REGION_IDS)).not.toThrow();
    expect(readRegion(blocked, REGION_IDS)).toBeNull();
    expect(saveRegion(blocked, "space-peak", REGION_IDS)).toBe(false);
    expect(clearRegion(blocked)).toBe(false);
    // No storage at all, as where the page cannot reach localStorage.
    expect(readRegion(null, REGION_IDS)).toBeNull();
    expect(saveRegion(null, "space-peak", REGION_IDS)).toBe(false);
    expect(clearRegion(undefined)).toBe(false);
  });

  it("gives no store where even reading localStorage throws", () => {
    const win = Object.defineProperty({}, "localStorage", {
      get() {
        throw new DOMException("Access is denied for this document.", "SecurityError");
      },
    }) as Pick<Window, "localStorage">;
    expect(deviceStore(win)).toBeNull();
    const { store } = memory();
    expect(deviceStore({ localStorage: store as Storage })).toBe(store);
  });

  it("clears the pick", () => {
    const { store, data } = memory();
    saveRegion(store, "fusion-canyon", REGION_IDS);
    expect(clearRegion(store)).toBe(true);
    expect(data.has(YOUR_REGION_KEY)).toBe(false);
    expect(readRegion(store, REGION_IDS)).toBeNull();
  });
});

// The slot as YourRegion.astro renders it, cut down to what the island reads.
const choice = (id: string, name: string) =>
  `<li><button type="button" data-region-pick="${id}" data-region-href="/regions/${id}/" aria-pressed="false">
    <img src="/art/brand/${id}-512-512.webp" srcset="/art/brand/${id}-512-512.webp 512w" sizes="40px" width="40" height="40" alt="" />
    <span><span data-region-name>${name}</span></span></button></li>`;
const SLOT = `<div data-your-region data-region-ids="${REGION_IDS.join(" ")}">
  <a href="/regions/" data-region-link>Pick your region</a>
  <button type="button" data-region-open hidden>Pick your region</button>
  <div data-region-mine hidden>
    <a href="/regions/" data-region-page><span data-region-crest></span><span data-region-name></span></a>
    <button type="button" data-region-change>Change your region</button>
  </div>
  <template data-region-template>
    <dialog aria-labelledby="t"><h2 id="t">Pick your region</h2><ul>
      ${choice("fusion-canyon", "Fusion Canyon")}${choice("photon-mountain", "Photon Mountain")}${choice("space-peak", "Space Peak")}
    </ul><p data-region-forget-row hidden><button type="button" data-region-forget>Forget my region</button></p></dialog>
  </template>
</div>`;

describe("the header slot", () => {
  beforeAll(() => {
    // jsdom lacks showModal and close; these stand-ins open and close the dialog.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  });

  const setUp = (store: RegionStore | null) => {
    document.body.innerHTML = SLOT;
    const slot = document.querySelector<HTMLElement>("[data-your-region]")!;
    initRegionSlot(slot, store);
    const $ = <T extends Element = HTMLElement>(sel: string) => slot.querySelector<T>(sel)!;
    return { slot, $, dialog: () => document.querySelector<HTMLDialogElement>("body > dialog") };
  };

  it("with no pick, swaps the link for the Pick your region button and builds no dialog yet", () => {
    const { $, dialog } = setUp(memory().store);
    expect($("[data-region-link]").hidden).toBe(true);
    expect($("[data-region-open]").hidden).toBe(false);
    expect($("[data-region-mine]").hidden).toBe(true);
    expect(dialog()).toBeNull();
  });

  it("with a pick, shows the region's crest and name, linking to its page", () => {
    const { $ } = setUp(memory({ [YOUR_REGION_KEY]: "space-peak" }).store);
    expect($("[data-region-open]").hidden).toBe(true);
    expect($("[data-region-mine]").hidden).toBe(false);
    expect($<HTMLAnchorElement>("[data-region-page]").getAttribute("href")).toBe("/regions/space-peak/");
    expect($("[data-region-mine] [data-region-name]").textContent).toBe("Space Peak");
    const crest = $<HTMLImageElement>("[data-region-crest] img");
    expect(crest.getAttribute("src")).toBe("/art/brand/space-peak-512-512.webp");
    expect([crest.getAttribute("width"), crest.getAttribute("height"), crest.getAttribute("sizes")]).toEqual(["32", "32", "32px"]);
  });

  it("opens the chooser, saves the region picked, and tells the page", () => {
    const { store, data } = memory();
    const { $, dialog } = setUp(store);
    const heard = vi.fn();
    document.addEventListener(YOUR_REGION_EVENT, (e) => heard((e as CustomEvent).detail), { once: true });
    $<HTMLButtonElement>("[data-region-open]").click();
    expect(dialog()?.open).toBe(true);
    expect(dialog()!.querySelector<HTMLElement>("[data-region-forget-row]")!.hidden).toBe(true);
    dialog()!.querySelector<HTMLButtonElement>('[data-region-pick="photon-mountain"]')!.click();
    expect(dialog()!.open).toBe(false);
    expect(data.get(YOUR_REGION_KEY)).toBe("photon-mountain");
    expect(heard).toHaveBeenCalledWith("photon-mountain");
    expect($("[data-region-mine]").hidden).toBe(false);
    expect(document.activeElement).toBe($("[data-region-page]"));
  });

  it("marks the current region in the chooser, and Forget my region clears it", () => {
    const { store, data } = memory({ [YOUR_REGION_KEY]: "fusion-canyon" });
    const { $, dialog } = setUp(store);
    $<HTMLButtonElement>("[data-region-change]").click();
    const pressed = [...dialog()!.querySelectorAll<HTMLElement>("[data-region-pick]")].map((b) => b.getAttribute("aria-pressed"));
    expect(pressed).toEqual(["true", "false", "false"]);
    expect(document.activeElement).toBe(dialog()!.querySelector('[data-region-pick="fusion-canyon"]'));
    const forget = dialog()!.querySelector<HTMLElement>("[data-region-forget-row]")!;
    expect(forget.hidden).toBe(false);
    forget.querySelector("button")!.click();
    expect(data.has(YOUR_REGION_KEY)).toBe(false);
    expect($("[data-region-open]").hidden).toBe(false);
    expect($("[data-region-mine]").hidden).toBe(true);
    expect(document.activeElement).toBe($("[data-region-open]"));
  });

  it("works with storage that throws: no pick on load, and a pick lasts for the page view", () => {
    const { $, dialog } = setUp(blocked);
    expect($("[data-region-open]").hidden).toBe(false);
    $<HTMLButtonElement>("[data-region-open]").click();
    expect(() => dialog()!.querySelector<HTMLButtonElement>('[data-region-pick="space-peak"]')!.click()).not.toThrow();
    expect($("[data-region-mine]").hidden).toBe(false);
  });

  it("keeps Escape inside the chooser, so the phone menu stays open", () => {
    const { $, dialog } = setUp(memory().store);
    $<HTMLButtonElement>("[data-region-open]").click();
    const onDocument = vi.fn();
    document.addEventListener("keydown", onDocument);
    dialog()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.removeEventListener("keydown", onDocument);
    expect(onDocument).not.toHaveBeenCalled();
  });
});

// Home's strip as ThisWeek.astro renders it: four events, the first three
// showing, two of them in Space Peak and one with no region.
const NAMES = { "photon-mountain": "Photon Mountain", "space-peak": "Space Peak", "fusion-canyon": "Fusion Canyon" };
const EVENTS = [
  { id: "e0", region: "photon-mountain", start: "2026-12-01T08:00:00-07:00" },
  { id: "e1", region: "", start: "2026-12-02T08:00:00-07:00" },
  { id: "e2", region: "photon-mountain", start: "2026-12-03T08:00:00-07:00" },
  { id: "e3", region: "space-peak", start: "2026-12-04T08:00:00-07:00" },
];
const STRIP = `<div data-this-week data-count="3"><ol>${EVENTS.map(
  (e, i) =>
    `<li id="${e.id}" data-starts="${new Date(e.start).toISOString()}" data-ends="${new Date(Date.parse(e.start) + 3_600_000).toISOString()}"${
      e.region ? ` data-event-region="${e.region}"` : ""
    }${i >= 3 ? " hidden" : ""}><time data-countdown>soon</time><a href="/event-calendar/">Event</a></li>`,
).join("")}</ol>
  <p data-events-empty hidden><a href="/event-calendar/">See the event calendar</a></p>
  <p data-region-first data-region-names='${JSON.stringify(NAMES)}' hidden>
    <span data-region-first-text>Showing your region first.</span> <button type="button" data-region-first-toggle>Show all</button>
  </p></div>`;

describe("This week on home", () => {
  const setUp = (store: RegionStore | null) => {
    document.body.innerHTML = STRIP;
    const root = document.querySelector<HTMLElement>("[data-this-week]")!;
    initRegionFirst(root, store);
    const order = () => [...root.querySelectorAll("li")].map((li) => li.id);
    const shown = () => [...root.querySelectorAll("li")].filter((li) => !li.hidden).map((li) => li.id);
    const line = root.querySelector<HTMLElement>("[data-region-first]")!;
    return { root, order, shown, line, toggle: line.querySelector<HTMLButtonElement>("button")! };
  };

  // These events are weeks ahead of the test's clock only if it reads 2026;
  // pin the clock so they never end.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-11-16T10:00:00-07:00") });
    return () => vi.useRealTimers();
  });

  it("keeps the build's order with no pick, and the line stays hidden", () => {
    const { order, shown, line } = setUp(memory().store);
    expect(order()).toEqual(["e0", "e1", "e2", "e3"]);
    expect(shown()).toEqual(["e0", "e1", "e2"]);
    expect(line.hidden).toBe(true);
  });

  it("keeps the build's order when storage throws", () => {
    const { order, line } = setUp(blocked);
    expect(order()).toEqual(["e0", "e1", "e2", "e3"]);
    expect(line.hidden).toBe(true);
  });

  it("puts the picked region's events first, soonest first, and says so", () => {
    const { order, shown, line } = setUp(memory({ [YOUR_REGION_KEY]: "space-peak" }).store);
    expect(order()).toEqual(["e3", "e0", "e1", "e2"]);
    expect(shown()).toEqual(["e3", "e0", "e1"]);
    expect(line.hidden).toBe(false);
    expect(line.textContent?.replace(/\s+/g, " ").trim()).toBe("Showing Space Peak first. Show all");
  });

  it("Show all brings back the date order, and the button puts the region first again", () => {
    const { order, line, toggle } = setUp(memory({ [YOUR_REGION_KEY]: "photon-mountain" }).store);
    expect(order()).toEqual(["e0", "e2", "e1", "e3"]);
    toggle.click();
    expect(order()).toEqual(["e0", "e1", "e2", "e3"]);
    expect(line.textContent?.replace(/\s+/g, " ").trim()).toBe("Showing every region. Show Photon Mountain first");
    toggle.click();
    expect(order()).toEqual(["e0", "e2", "e1", "e3"]);
  });

  it("follows a pick made in the header, and a forget", () => {
    const { order, line } = setUp(memory().store);
    document.dispatchEvent(new CustomEvent(YOUR_REGION_EVENT, { detail: "space-peak" }));
    expect(order()[0]).toBe("e3");
    expect(line.hidden).toBe(false);
    document.dispatchEvent(new CustomEvent(YOUR_REGION_EVENT, { detail: null }));
    expect(order()).toEqual(["e0", "e1", "e2", "e3"]);
    expect(line.hidden).toBe(true);
  });

  it("stays as built when the pick has no events in the strip", () => {
    const { order, line } = setUp(memory({ [YOUR_REGION_KEY]: "fusion-canyon" }).store);
    expect(order()).toEqual(["e0", "e1", "e2", "e3"]);
    expect(line.hidden).toBe(true);
  });
});
