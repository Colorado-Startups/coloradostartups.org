// The network guard for the Communitas pool: the site's rule
// (site/test/worker/net-guard.ts), applied by wrapping fetch() because this
// pool has no MSW. A test reaches loopback (the pool's own traffic) and its
// fakes, nothing else. createSlackClient falls back to the real fetch() when a
// test passes no fetchImpl, so without this a test could post to Slack (#660).

import { afterEach } from "vitest";

import { assertNothingBlocked, isLoopbackHost, recordBlocked } from "../../../site/test/worker/net-guard";

const realFetch = globalThis.fetch;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (!isLoopbackHost(url.hostname)) {
    recordBlocked(request.method, url);
    throw new TypeError(`Network guard: blocked ${request.method} ${url.origin}${url.pathname}`);
  }
  return realFetch(request);
};

afterEach(() => assertNothingBlocked());
