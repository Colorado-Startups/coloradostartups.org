import { HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll } from "vitest";

import { assertNothingBlocked, isLoopbackHost, recordBlocked } from "./net-guard";
import { server } from "./server";

// A test reaches loopback (the pool's and D1's own traffic) and whatever its
// handlers mock. Any other request is blocked, and the test fails after it
// ends, even when the code under test caught the rejection (net-guard.ts).
beforeAll(() => {
  server.configure({
    async onUnhandledFrame({ frame, defaults }) {
      if (frame.protocol !== "http") return;
      const { request } = frame.data as { request: Request };
      const url = new URL(request.url);
      if (isLoopbackHost(url.hostname)) return;
      recordBlocked(request.method, url);
      // msw 3's defaults.error() only prints (msw 2's print.error() also failed
      // the request), so the guard fails it itself: a thrown Response is the
      // answer, and Response.error() makes the Worker's fetch() reject.
      await defaults.error();
      throw HttpResponse.error();
    },
  });
  return server.enable();
});
afterEach(() => {
  server.resetHandlers();
  assertNothingBlocked();
});
afterAll(() => server.disable());
