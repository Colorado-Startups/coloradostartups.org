// URL helpers. Pure functions, no network.

// Google Docs wraps every outbound link as
// https://www.google.com/url?q=<target>&sa=D&source=editors&ust=...&usg=...
// The ust and usg values change on every export, so the wrapper is never kept.
// A few links in the Doc are wrapped twice, with the inner query
// percent-encoded (url?q%3Dhttps://...%26sa%...), so unwrapping repeats.
export function unwrapGoogleRedirect(href) {
  let current = String(href ?? "").trim();
  for (let i = 0; i < 3; i += 1) {
    let parsed;
    try {
      parsed = new URL(current);
    } catch {
      return current;
    }
    const host = parsed.hostname.toLowerCase();
    if (!/(^|\.)google\.[a-z.]+$/.test(host) || parsed.pathname !== "/url") return current;
    let target = parsed.searchParams.get("q");
    if (!target) {
      // The doubly wrapped form: the "?q=" itself arrived encoded as "?q%3D".
      const decoded = decodeURIComponent(parsed.search.replace(/^\?/, ""));
      const match = /^q=([^&]+)/.exec(decoded);
      target = match ? match[1] : null;
    }
    if (!target) return current;
    current = target;
  }
  return current;
}

// Query parameters that only track a click. Dropped so two links to the same
// page count as one.
const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid)$/i;

// The public form of a link: the Google wrapper removed, the fragment and
// tracking parameters dropped, and a trailing "&" (a Doc artifact) cut. The
// scheme stays as the Doc wrote it; the link checker reports what the site
// actually serves.
export function cleanUrl(raw) {
  const unwrapped = unwrapGoogleRedirect(raw).replace(/&+$/, "");
  let parsed;
  try {
    parsed = new URL(unwrapped);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) parsed.searchParams.delete(key);
  }
  parsed.hostname = parsed.hostname.toLowerCase();
  return parsed.toString();
}

// The key two links share when they point at the same page: scheme, "www."
// and a trailing slash ignored. Used only to find duplicates.
export function dedupeKey(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return String(url).toLowerCase();
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
  const query = parsed.search.toLowerCase();
  return `${host}${path}${query}`;
}

// The registrable part of a host, close enough for spotting a link that now
// redirects to another site (example.co.uk is not a concern in this Doc).
export function siteOf(url) {
  try {
    const parts = new URL(url).hostname.toLowerCase().replace(/^www\./, "").split(".");
    return parts.slice(-2).join(".");
  } catch {
    return "";
  }
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

// A profile page about one person, not an organization's own site.
export function isPersonProfile(url) {
  const host = hostOf(url);
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (host.endsWith("linkedin.com") && path.startsWith("/in/")) return true;
  if (host.endsWith("crunchbase.com") && path.startsWith("/person/")) return true;
  if (host === "angel.co" || host === "wellfound.com") return path.startsWith("/u/") || path.startsWith("/p/");
  return false;
}

// A third-party database profile standing in for an organization's own site.
// The brief keeps Crunchbase out of the site, so these never become a
// resource URL; the row goes to the review report instead.
export function isAggregatorProfile(url) {
  const host = hostOf(url);
  return host.endsWith("crunchbase.com") || host.endsWith("pitchbook.com");
}

// Query parameters and paths that credit someone's account when a visitor
// signs up. A directory link must not pay anyone, and a code often names a
// person (decision 27), so these rows go to the review report instead.
const REFERRAL_PARAMS = /^(referral|referral_code|referralcode|ref|rc|invite|invite_code|affiliate|aff|aff_id)$/i;

export function isReferralUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if ([...parsed.searchParams.keys()].some((k) => REFERRAL_PARAMS.test(k))) return true;
  return /\/(?:signup|sign-up|join|invite|r)\/?$/i.test(parsed.pathname) && parsed.search.length > 1
    || /\/(?:invite|referral|ref)\/[^/]+/i.test(parsed.pathname);
}
