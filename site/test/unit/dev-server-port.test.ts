import { describe, expect, it } from "vitest";

import config from "../../astro.config.mjs";

// The managed Mac policy (README, Ports) gives this account 3300 to 3349 and
// bans vendor default ports. `astro dev` must take 3303 and exit when it is
// taken, instead of Vite's default of trying the next port (#279).
describe("astro dev server port", () => {
  it("serves on 3303, inside the account's block and not Astro's 4321", () => {
    expect(config.server).toMatchObject({ port: 3303 });
  });

  it("exits when the port is taken instead of moving to the next one", () => {
    expect(config.vite?.server?.strictPort).toBe(true);
  });
});
