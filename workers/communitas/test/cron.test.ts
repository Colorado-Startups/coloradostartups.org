import { describe, expect, it } from "vitest";

import { LIBRARY } from "../src/library";
import { handleScheduled, pickOpener } from "../src/threads";
import { fakeDeps } from "./helpers";

// 15:00 UTC, the cron's time in wrangler.jsonc.
const MON = Date.UTC(2026, 9, 19, 15); // Monday, Oct 19, 2026
const TUE = Date.UTC(2026, 9, 20, 15);
const WED = Date.UTC(2026, 9, 21, 15);
const FRI = Date.UTC(2026, 9, 23, 15);
const WEEK = 7 * 24 * 60 * 60 * 1000;

describe("pickOpener", () => {
  it("picks an opener for the right day", () => {
    expect(pickOpener(LIBRARY.threads, MON)?.day).toBe("mon");
    expect(pickOpener(LIBRARY.threads, WED)?.day).toBe("wed");
    expect(pickOpener(LIBRARY.threads, FRI)?.day).toBe("fri");
  });

  it("picks nothing on other days", () => {
    expect(pickOpener(LIBRARY.threads, TUE)).toBeUndefined();
  });

  it("moves to the next opener each week and starts over at the end", () => {
    const mondays = LIBRARY.threads.filter((t) => t.day === "mon");
    const ids = mondays.map((_, i) => pickOpener(LIBRARY.threads, MON + i * WEEK)?.id);
    expect(new Set(ids).size).toBe(mondays.length);
    expect(pickOpener(LIBRARY.threads, MON + mondays.length * WEEK)?.id).toBe(ids[0]);
  });

  it("only ever returns an entry from the library", () => {
    for (let i = 0; i < 30; i++) {
      const t = pickOpener(LIBRARY.threads, MON + i * 24 * 60 * 60 * 1000);
      if (t) expect(LIBRARY.threads).toContain(t);
    }
  });
});

describe("the weekly cron", () => {
  const awake = { COMMUNITAS_PAUSED: "false" };

  it("posts the day's opener as a new message in the threads channel", async () => {
    const { deps, rec } = fakeDeps({ threadsChannel: "C0THREADS" });
    await handleScheduled(MON, awake, deps);
    const opener = pickOpener(LIBRARY.threads, MON)!;
    expect(rec.posts).toHaveLength(1);
    expect(rec.posts[0].channel).toBe("C0THREADS");
    expect(rec.posts[0].thread_ts).toBeUndefined();
    expect(rec.posts[0].text).toContain(opener.title);
    expect(rec.posts[0].text).toContain(opener.body);
    expect(JSON.stringify(rec.posts[0].blocks)).toContain(LIBRARY.disclosure.communitas);
  });

  it("does nothing at all while paused", async () => {
    const { deps, rec } = fakeDeps({ threadsChannel: "C0THREADS" });
    await handleScheduled(MON, { COMMUNITAS_PAUSED: "true" }, deps);
    expect(rec.posts).toEqual([]);
    expect(rec.logs).toEqual([]);
  });

  it("posts nothing on a day without an opener", async () => {
    const { deps, rec } = fakeDeps({ threadsChannel: "C0THREADS" });
    await handleScheduled(TUE, awake, deps);
    expect(rec.posts).toEqual([]);
  });

  it("posts nothing, and says why, when no channel is set", async () => {
    const { deps, rec } = fakeDeps();
    await handleScheduled(MON, awake, deps);
    expect(rec.posts).toEqual([]);
    expect(rec.logs.map((l) => l.event)).toContain("threads_channel_unset");
  });

  it("logs a Slack failure and does not throw", async () => {
    const { deps, rec } = fakeDeps({ threadsChannel: "C0THREADS", failPost: true });
    await expect(handleScheduled(MON, awake, deps)).resolves.toBeUndefined();
    expect(rec.logs.map((l) => l.event)).toContain("opener_failed");
  });
});
