// Secrets set with `wrangler secret put`. They are not in wrangler.jsonc, so
// `wrangler types` cannot see them; they are declared here instead. Optional,
// because a route must degrade (503) rather than crash when one is missing.
interface Env {
  TURNSTILE_SECRET_KEY?: string;
  KIT_API_KEY?: string;
  // Kit form id for double opt-in. Not secret; set beside the key with `wrangler secret put`.
  KIT_FORM_ID?: string;
  // Test-only: lets loadCards() fall back to the fictional fixture cards. Never set in production.
  RESOURCUS_ALLOW_FIXTURE?: string;
}
