// The kill switch. Anything but the exact string "false" means paused, so a
// typo or a missing var fails safe. wrangler.jsonc ships it as "true".
export function isPaused(env: { COMMUNITAS_PAUSED?: string }): boolean {
  return env.COMMUNITAS_PAUSED !== "false";
}
