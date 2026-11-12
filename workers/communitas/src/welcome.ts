// team_join: the one message Communitas ever sends unprompted. It goes to the
// new member's DM, from the approved template, exactly once per delivery.
// Slack's retries of the same event are dropped before this runs (app.ts),
// because the Worker keeps no state to remember who it has welcomed.

import { type Deps, errorCode } from "./deps";
import { renderCopy } from "./format";

export interface JoinedUser {
  id?: string;
  is_bot?: boolean;
  is_app_user?: boolean;
  deleted?: boolean;
}

// DMs the welcome message to a member who just joined. Skips bots, app users
// and deleted accounts; a failed send is logged, never thrown.
export async function handleTeamJoin(user: JoinedUser, deps: Deps): Promise<void> {
  if (!user?.id || user.is_bot || user.is_app_user || user.deleted) return;
  const { welcome } = deps.library.slack;
  try {
    const channel = await deps.slack.openDm(user.id);
    const message = renderCopy(welcome, deps.siteOrigin, deps.library.disclosure.communitas);
    await deps.slack.postMessage({ channel, ...message });
    deps.log("welcome_sent", { template: welcome.id });
  } catch (err) {
    deps.log("welcome_failed", { template: welcome.id, error: errorCode(err) });
  }
}
