// Pure helpers for the CSP violation sink. routes/csp-report.ts stores the
// reports; this module parses an attacker-supplied report and NORMALIZES it
// into a small, deduplicated, PII-free shape. Kept free of Workers imports so
// it unit-tests in plain Node.
//
// Normalization is what keeps the table bounded: blocked_uri collapses to
// scheme+host and document_uri to a path, so a flood of unique URLs (or query
// strings carrying identifiers) cannot blow up the row count or store PII.

const MAX_FIELD = 200;

// A parsed, normalized CSP violation, ready to upsert.
export interface CspViolation {
  directive: string;
  blockedUri: string;
  documentUri: string;
  signature: string;
}

// Normalize blocked-uri. Browsers send a full URL, a bare scheme ("data",
// "blob"), or a keyword ("inline", "eval", "self"). For URLs we keep scheme+host
// so "https://evil.example/a?token=x" and ".../b" collapse to one row and no
// query string is stored. Non-URL values pass through lowercased and capped.
export function normalizeBlockedUri(raw: string): string {
  const v = (raw || "").trim().slice(0, MAX_FIELD);
  if (!v) return "(empty)";
  try {
    const u = new URL(v);
    return `${u.protocol}//${u.host}`;
  } catch {
    return v.toLowerCase();
  }
}

// Document path only (strip origin and query): the origin is always our site,
// and a query string can carry identifiers.
export function normalizeDocumentPath(raw: string): string {
  const v = (raw || "").trim().slice(0, MAX_FIELD);
  if (!v) return "/";
  try {
    return new URL(v).pathname || "/";
  } catch {
    return v.split(/[?#]/)[0] || "/";
  }
}

// First directive token (effective-directive preferred upstream), lowercased.
export function normalizeDirective(raw: string): string {
  const v = (raw || "").trim().toLowerCase().slice(0, MAX_FIELD);
  return v.split(/\s+/)[0] || "unknown";
}

function cspSignature(directive: string, blockedUri: string, documentUri: string): string {
  return `${directive}|${blockedUri}|${documentUri}`;
}

// Parse a classic report-uri body ({"csp-report": {...}}) into a normalized
// violation, or null if it is not a recognizable report. Defensive throughout:
// the body is attacker-supplied and may be any shape.
export function parseCspReport(json: unknown): CspViolation | null {
  if (!json || typeof json !== "object") return null;
  const report = (json as Record<string, unknown>)["csp-report"];
  if (!report || typeof report !== "object") return null;
  const r = report as Record<string, unknown>;
  const directiveRaw =
    (typeof r["effective-directive"] === "string" && r["effective-directive"]) ||
    (typeof r["violated-directive"] === "string" && r["violated-directive"]) ||
    "";
  const blockedRaw = typeof r["blocked-uri"] === "string" ? r["blocked-uri"] : "";
  const docRaw = typeof r["document-uri"] === "string" ? r["document-uri"] : "";
  const directive = normalizeDirective(String(directiveRaw));
  const blockedUri = normalizeBlockedUri(String(blockedRaw));
  const documentUri = normalizeDocumentPath(String(docRaw));
  // A report with neither a directive nor a blocked target is noise.
  if (directive === "unknown" && blockedUri === "(empty)") return null;
  return {
    directive,
    blockedUri,
    documentUri,
    signature: cspSignature(directive, blockedUri, documentUri),
  };
}
