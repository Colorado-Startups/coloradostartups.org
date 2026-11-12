// The text a log line carries for a caught value: an Error's message, or the
// value as a string. Every catch in site/worker logs through this.
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
