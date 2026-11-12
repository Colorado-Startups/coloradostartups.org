import { describe, expect, it } from "vitest";

import { LIBRARY } from "../src/library";
import { handleTeamJoin } from "../src/welcome";
import { fakeDeps, SITE } from "./helpers";

const member = { id: "U0NEW", is_bot: false, deleted: false };

describe("team_join: one welcome DM from the approved template", () => {
  it("opens a DM with the new member and posts the welcome once", async () => {
    const { deps, rec } = fakeDeps();
    await handleTeamJoin(member, deps);
    expect(rec.dmsOpened).toEqual(["U0NEW"]);
    expect(rec.posts).toHaveLength(1);
    expect(rec.posts[0].channel).toBe("D-U0NEW");
  });

  it("uses every line of the approved welcome, with links on the site origin", async () => {
    const { deps, rec } = fakeDeps();
    await handleTeamJoin(member, deps);
    const { text } = rec.posts[0];
    for (const line of LIBRARY.slack.welcome.lines) expect(text).toContain(line);
    for (const link of LIBRARY.slack.welcome.links) expect(text).toContain(`<${SITE}${link.path}|${link.label}>`);
  });

  it("discloses that Communitas is an AI agent", async () => {
    const { deps, rec } = fakeDeps();
    await handleTeamJoin(member, deps);
    expect(rec.posts[0].text).toContain(LIBRARY.disclosure.communitas);
    expect(JSON.stringify(rec.posts[0].blocks)).toContain(LIBRARY.disclosure.communitas);
  });

  it.each([
    ["a bot", { ...member, is_bot: true }],
    ["an app user", { ...member, is_app_user: true }],
    ["a deleted account", { ...member, deleted: true }],
    ["a payload with no id", { is_bot: false }],
  ])("sends nothing to %s", async (_label, user) => {
    const { deps, rec } = fakeDeps();
    await handleTeamJoin(user as never, deps);
    expect(rec.dmsOpened).toEqual([]);
    expect(rec.posts).toEqual([]);
  });

  it("logs a Slack failure without the raw user id and does not throw", async () => {
    const { deps, rec } = fakeDeps({ failPost: true });
    await expect(handleTeamJoin(member, deps)).resolves.toBeUndefined();
    expect(rec.logs.map((l) => l.event)).toContain("welcome_failed");
    expect(JSON.stringify(rec.logs)).not.toContain("U0NEW");
  });
});
