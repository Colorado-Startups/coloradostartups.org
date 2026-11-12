// The network rule both Worker test pools share (site/test/worker/msw.ts and
// workers/communitas/test/net-guard-setup.ts): a test reaches loopback, which
// is the pool's own traffic, and nothing else unless a handler or a fake
// answers it. No dependencies, so the Communitas pool can import it.
//
// A blocked request rejects like a network error. Code under test often
// catches that (Turnstile fails closed, Kit reports "unavailable"), so each
// pool also checks `blocked` after every test and fails the test there (#660).

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;

// True for localhost, *.localhost, 127.x.x.x and [::1]. Case and a trailing
// dot are ignored, so `API.KIT.COM.` is the same host as `api.kit.com`.
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return LOOPBACK.test(h) || h.endsWith(".localhost");
}

// Requests blocked since the last check, as "METHOD origin/path".
export const blocked: string[] = [];

// Records one blocked request.
export function recordBlocked(method: string, url: URL): void {
  blocked.push(`${method} ${url.origin}${url.pathname}`);
}

// Throws when any request was blocked since the last call, and clears the list.
export function assertNothingBlocked(): void {
  const hits = blocked.splice(0);
  if (hits.length > 0) {
    throw new Error(
      `Unmocked request to a third party: ${hits.join(", ")}. ` +
        "Mock it (server.use(...) in the site, a fake fetchImpl or deps in Communitas).",
    );
  }
}
