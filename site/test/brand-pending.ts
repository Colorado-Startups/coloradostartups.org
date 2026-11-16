// Color roles the brand's tokens.json defines that the site has not taken in
// yet. Brand v4.4.0 added the region colors (each a fill, with its on-region
// ink). Step A6a pulled that release for /agents/ and left them out of
// 01_doctrine/brand_tokens.yaml on purpose. Step W0b in the engagement plan
// ("Region colors follow the crest tokens") adopts them and deletes this file.
// Until then the token tests (brand-tokens-sync and l12/contrast) let only
// these roles, and the pairings that name them, be missing from the site.
// brand-tokens-sync fails once brand_tokens.yaml declares a listed role, so
// a role cannot stay on this list after the site takes it in.
export const PENDING_BRAND_ROLES: readonly string[] = [
  "region-photon-mountain",
  "on-region-photon-mountain",
  "region-space-peak",
  "on-region-space-peak",
  "region-fusion-canyon",
  "on-region-fusion-canyon",
];

/** True for a brand role the site may still lack: pending and not declared in `declared`. */
export const pendingAndAbsent = (role: string, declared: Readonly<Record<string, unknown>>): boolean =>
  PENDING_BRAND_ROLES.includes(role) && !Object.hasOwn(declared, role);

/**
 * Listed roles the site already declares, in `color` or `night` of
 * brand_tokens.yaml, each as a line saying what to do; [] when none is.
 */
export function adoptedButPending(tokens: {
  color?: Readonly<Record<string, unknown>>;
  night?: Readonly<Record<string, unknown>>;
}): string[] {
  return PENDING_BRAND_ROLES.filter((role) => Object.hasOwn(tokens.color ?? {}, role) || Object.hasOwn(tokens.night ?? {}, role)).map(
    (role) => `${role} is declared in 01_doctrine/brand_tokens.yaml: remove it from PENDING_BRAND_ROLES in site/test/brand-pending.ts`,
  );
}
