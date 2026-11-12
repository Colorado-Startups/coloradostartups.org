// One home for the Worker's constants. Everything that names a domain, an
// address or a limit lives here.

export const SITE_ORIGIN = "https://coloradostartups.org";
export const SITE_NAME = "Colorado Startups";

// Form notifications go to Paul through Cloudflare Email Service. The binding
// only works once coloradostartups.org is on Cloudflare DNS and the sending
// subdomain is onboarded (plan, Domain cutover step 6). Until then the D1
// queue is the record and notify() logs and returns.
export const FORM_SENDER = "forms@email.coloradostartups.org";
export const NOTIFY_TO = "paul@coloradostartups.org";

// A real person needs at least this long to fill a form. Faster posts are bots.
export const MIN_SUBMIT_MS = 3000;

// Largest form body any route accepts, counted in bytes actually received.
// Content-Length is only a hint: a chunked body has none (L2 and L6 reviews).
export const MAX_FORM_BYTES = 16 * 1024;

// Per-field caps applied after trimming. Lanes add their own fields here
// through the orchestrator so every handler shares one table.
export const FIELD_LIMITS = {
  name: 120,
  email: 254,
  url: 300,
  shortText: 160,
  longText: 2000,
} as const;
