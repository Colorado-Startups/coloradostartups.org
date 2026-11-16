// The Cloudflare Web Analytics beacon, taken out of a page before the test
// server sends it (serve-dist.mjs). The built files keep the tag: production
// serves them as they are, and test/dom/analytics-beacon.test.ts checks every
// built page carries it once.
//
// Why: in the 7 days to 2026-11-15, 2,732 of 3,218 recorded page views came
// from host 127.0.0.1, the e2e runs (#66). A test run is not a visit.

export const BEACON_HOST = "static.cloudflareinsights.com";

const BEACON_TAG = new RegExp(`<script\\b[^>]*\\bsrc="https://${BEACON_HOST.replaceAll(".", "\\.")}/[^"]*"[^>]*>\\s*</script>`, "g");

/** The page without its analytics beacon tag. Every other script stays. */
export function stripBeacon(html) {
  return html.replace(BEACON_TAG, "");
}
