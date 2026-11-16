// Color roles the brand's tokens.json defines that the site has not taken in
// yet. Brand v4.4.0 added the region colors (each a fill, with its on-region
// ink). Step A6a pulled that release for /agents/ and left them out of
// 01_doctrine/brand_tokens.yaml on purpose: the step that uses them adopts
// them. Until then the token tests (brand-tokens-sync and l12/contrast) let
// only these roles, and the pairings that name them, be missing from the
// site. A role the site declares is checked like any other, listed or not.
// Drop a role from this list once brand_tokens.yaml declares it.
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
