// The offline link checker. It runs on a person's machine or in a script,
// never in a Worker: no Worker ever fetches a URL a user supplied (brief
// section 2.12). It only asks each site for its status; it reads no content.
//
// Outcomes:
//   ok          2xx or 3xx after redirects
//   dead        404 or 410, or the host does not resolve or refuses the
//               connection twice
//   tls         the site answers with a certificate a browser would reject
//               (expired, self-signed, or issued for another name), or
//               Cloudflare reports 525 or 526 for its origin
//   unverified  anything else (401, 403, 429, 5xx, LinkedIn's 999, a timeout,
//               a certificate chain Node cannot complete but a browser can).
//               Could not verify is not the same as dead, so these are listed
//               for a spot-check and never fail a run.
//
// Each result keeps what the site said: status, error code and final URL.
// outcomeOf() derives the outcome from those facts.

const USER_AGENT =
  "Mozilla/5.0 (compatible; ColoradoStartupsLinkCheck/1.0; +https://coloradostartups.org/ecosystem-canvas/)";

const DEAD_CODES = new Set(["ENOTFOUND", "ECONNREFUSED"]);
const TLS_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function errorCode(err) {
  let e = err;
  for (let i = 0; i < 4 && e; i += 1) {
    if (e.code) return String(e.code);
    if (e.name === "TimeoutError" || e.name === "AbortError") return "TIMEOUT";
    e = e.cause;
  }
  return "ERROR";
}

/**
 * Maps one HTTP status or network error code to an outcome.
 * @param {{ status?: number, code?: string }} facts
 */
export function outcomeOf({ status, code }) {
  if (code) {
    if (DEAD_CODES.has(code)) return "dead";
    if (TLS_CODES.has(code)) return "tls";
    return "unverified";
  }
  if (status >= 200 && status < 400) return "ok";
  // Cloudflare's 525 (TLS handshake failed) and 526 (invalid certificate)
  // mean the site's own certificate is broken, the same as a TLS error here.
  if (status === 525 || status === 526) return "tls";
  if (status === 404 || status === 410) return "dead";
  return "unverified";
}

async function request(url, method, { fetchImpl, timeoutMs }) {
  const res = await fetchImpl(url, {
    method,
    redirect: "follow",
    // Node's fetch sends "Accept-Language: *" by default, and some sites
    // redirect that to a locale page that does not exist (ibm.com did).
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.8" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  // Only the status matters; release the body without reading it.
  try {
    await res.body?.cancel();
  } catch {
    // A body that cannot be cancelled is not a link problem.
  }
  return res;
}

/**
 * @typedef {(url: string, init: any) => Promise<{ status: number, url: string, body: { cancel(): Promise<void> } | null }>} FetchLike
 * @typedef {{ fetchImpl?: FetchLike, timeoutMs?: number, now?: () => Date }} CheckOptions
 */

/**
 * Checks one URL: HEAD first, then GET when the server refuses HEAD or
 * answers it with an error, because many sites only implement GET.
 * @param {string} url
 * @param {CheckOptions} [options]
 */
export async function checkUrl(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? /** @type {FetchLike} */ (/** @type {unknown} */ (fetch));
  const timeoutMs = options.timeoutMs ?? 15000;
  const now = options.now ?? (() => new Date());
  const checkedAt = now().toISOString();
  const attempt = async (method) => {
    try {
      const res = await request(url, method, { fetchImpl, timeoutMs });
      return { status: res.status, finalUrl: res.url || url };
    } catch (err) {
      return { code: errorCode(err), error: err instanceof Error ? err.message : String(err) };
    }
  };
  let r = await attempt("HEAD");
  if (r.code || r.status >= 400) r = await attempt("GET");
  // One retry for a refused or unresolved host, so a blip is not "dead".
  if (r.code && DEAD_CODES.has(r.code)) r = await attempt("GET");
  const outcome = outcomeOf(r);
  return {
    url,
    outcome,
    ...(r.status !== undefined ? { status: r.status } : {}),
    ...(r.finalUrl && r.finalUrl !== url ? { finalUrl: r.finalUrl } : {}),
    ...(r.code ? { error: r.code } : {}),
    checkedAt,
  };
}

/**
 * Checks many URLs with a global concurrency cap and one request at a time
 * per host, so no single site sees a burst.
 * @param {string[]} urls
 * @param {CheckOptions & { concurrency?: number, onResult?: (r: any) => void }} [options]
 */
export async function checkUrls(urls, { concurrency = 8, onResult, ...opts } = {}) {
  const byHost = new Map();
  for (const url of urls) {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      host = url;
    }
    byHost.set(host, [...(byHost.get(host) ?? []), url]);
  }
  const queues = [...byHost.values()];
  const results = {};
  let next = 0;
  async function worker() {
    while (next < queues.length) {
      const queue = queues[next];
      next += 1;
      for (const url of queue) {
        const r = await checkUrl(url, opts);
        results[url] = r;
        onResult?.(r);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results;
}
