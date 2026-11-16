// The Cloudflare Web Analytics beacon, taken out of a page before the test
// server sends it (serve-dist.mjs). The built files keep the tag: production
// serves them as they are, and test/dom/analytics-beacon.test.ts checks every
// built page carries it once.
//
// Why: in the 7 days to 2026-11-15, 2,732 of 3,218 recorded page views came
// from host 127.0.0.1, the e2e runs (#66). A test run is not a visit.
//
// BaseLayout marks the tag with this attribute, so the cut needs no pattern
// for a script tag or a host name: it finds the mark, then the tag around it.

export const BEACON_MARK = "data-cs-beacon";

const OPEN = "<script";
const CLOSE = "</script>";

/** The page without its analytics beacon tag. Every other script stays. */
export function stripBeacon(html) {
  let out = html;
  for (let at = out.indexOf(BEACON_MARK); at >= 0; at = out.indexOf(BEACON_MARK)) {
    const start = out.lastIndexOf(OPEN, at);
    const end = out.indexOf(CLOSE, at);
    // The mark outside a script tag is page text, not the beacon: leave it.
    if (start < 0 || end < 0 || out.indexOf(">", start) < at) break;
    out = out.slice(0, start) + out.slice(end + CLOSE.length);
  }
  return out;
}
