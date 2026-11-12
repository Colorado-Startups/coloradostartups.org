import { describe, expect, it } from "vitest";

import { helpResponse } from "../src/commands";
import { LIBRARY } from "../src/library";
import { fakeDeps, SITE } from "./helpers";

describe("/communitas", () => {
  it("answers privately to the person who typed it", () => {
    const { deps } = fakeDeps();
    expect(helpResponse(deps).response_type).toBe("ephemeral");
  });

  it("shows every approved help line and link, plus the disclosure", () => {
    const { deps } = fakeDeps();
    const { text } = helpResponse(deps);
    for (const line of LIBRARY.slack.help.lines) expect(text).toContain(line);
    for (const link of LIBRARY.slack.help.links) expect(text).toContain(`<${SITE}${link.path}|${link.label}>`);
    expect(text).toContain(LIBRARY.disclosure.communitas);
  });
});
