// Values set with `wrangler secret put` (not visible to `wrangler types`).
// Runbook: ops/runbooks/communitas-slack.md.
interface Env {
  SLACK_SIGNING_SECRET?: string;
  SLACK_BOT_TOKEN?: string;
  USER_KEY_SALT?: string;
  // The channel id for the weekly openers. Not a secret, but it differs per
  // workspace, so it is set per Worker like the three secrets. Unset means the
  // cron posts nothing.
  COMMUNITAS_THREADS_CHANNEL?: string;
}
