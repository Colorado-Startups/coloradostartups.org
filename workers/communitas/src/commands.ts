// /communitas: a private help card for the person who typed it. Any text after
// the command gets the same card; questions go through a mention instead, so
// every answer is visible in a thread.

import type { Deps } from "./deps";
import { renderCopy } from "./format";

// The /communitas reply: the library's help copy with the AI disclosure, shown
// only to the member who asked (ephemeral).
export function helpResponse(deps: Pick<Deps, "library" | "siteOrigin">) {
  const message = renderCopy(deps.library.slack.help, deps.siteOrigin, deps.library.disclosure.communitas);
  return { response_type: "ephemeral" as const, ...message };
}
