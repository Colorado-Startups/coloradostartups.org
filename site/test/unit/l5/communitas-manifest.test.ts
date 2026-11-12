import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Contract test for workers/communitas/slack-app-manifest.yaml. Paul creates
// the Slack app from that file, so it decides what Communitas may do in a
// workspace. The scopes stay at the minimum the Worker uses, the events match
// the handlers app.ts registers, and the description says plainly what the
// app is and is not connected to.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const manifestText = readFileSync(path.join(ROOT, "workers/communitas/slack-app-manifest.yaml"), "utf8");
const manifest = parse(manifestText);
const appSource = readFileSync(path.join(ROOT, "workers/communitas/src/app.ts"), "utf8");

const registered = (kind: "event" | "command") =>
  [...appSource.matchAll(new RegExp(`app\\.${kind}\\("([^"]+)"`, "g"))].map((m) => m[1]).sort();

describe("Communitas Slack app manifest", () => {
  it("asks for exactly the minimum bot scopes and no user scopes", () => {
    expect([...manifest.oauth_config.scopes.bot].sort()).toEqual([
      "app_mentions:read",
      "chat:write",
      "commands",
      "im:write",
      "users:read",
    ]);
    expect(manifest.oauth_config.scopes.user).toBeUndefined();
  });

  it("subscribes to exactly the events app.ts handles", () => {
    expect([...manifest.settings.event_subscriptions.bot_events].sort()).toEqual(registered("event"));
    expect(registered("event")).toEqual(["app_mention", "team_join"]);
  });

  it("declares exactly the slash commands app.ts handles", () => {
    const commands = manifest.features.slash_commands.map((c: { command: string }) => c.command).sort();
    expect(commands).toEqual(registered("command"));
  });

  it("points Slack at the Worker's two routes, with a host placeholder to fill in", () => {
    expect(manifest.settings.event_subscriptions.request_url).toBe("https://WORKER_HOST/slack/events");
    expect(manifest.features.slash_commands[0].url).toBe("https://WORKER_HOST/slack/commands");
  });

  it("uses no socket mode, no interactivity, no org-wide deploy and no token rotation", () => {
    expect(manifest.settings.socket_mode_enabled).toBe(false);
    expect(manifest.settings.interactivity.is_enabled).toBe(false);
    expect(manifest.settings.org_deploy_enabled).toBe(false);
    expect(manifest.settings.token_rotation_enabled).toBe(false);
  });

  it("makes the DM tab read-only, because Communitas never reads DMs", () => {
    expect(manifest.features.app_home.messages_tab_enabled).toBe(true);
    expect(manifest.features.app_home.messages_tab_read_only_enabled).toBe(true);
    expect(manifest.features.app_home.home_tab_enabled).toBe(false);
  });

  it("discloses the AI agent and says it is not connected to any Claude account", () => {
    const { description, long_description } = manifest.display_information;
    expect(description).toMatch(/AI agent run by Colorado Startups/);
    expect(long_description).toMatch(/AI agent run by Colorado Startups/);
    expect(long_description).toMatch(/not connected to any Claude account/);
    expect(long_description).toMatch(/own Slack app with its own bot token/);
  });

  it("fits Slack's display field limits", () => {
    const { name, description, long_description } = manifest.display_information;
    expect(name.length).toBeLessThanOrEqual(35);
    expect(description.length).toBeLessThanOrEqual(140);
    expect(long_description.length).toBeGreaterThanOrEqual(175);
    expect(long_description.length).toBeLessThanOrEqual(4000);
  });
});
