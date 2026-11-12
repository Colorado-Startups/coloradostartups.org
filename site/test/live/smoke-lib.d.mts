// Types for smoke-lib.mjs, so the L11 unit and worker tests import it checked.
export type Level = "ok" | "PENDING" | "WARN" | "FAIL" | "CANNOT";
export interface Result {
  level: Level;
  check: string;
  detail: string;
}
export interface NavPage {
  path: string;
  kind: "html" | "json" | "xml";
}
export interface FormRoute {
  path: string;
  thanks: string;
  limiter: string;
  unavailable: "pending" | "fail";
  writes: string;
  fields: (now: number) => Record<string, string>;
}
export interface HeaderSource {
  get(name: string): string | null | undefined;
}
export const BAD_TOKEN: string;
export const NAV_PAGES: NavPage[];
export const FORM_ROUTES: FormRoute[];
export const ASK_ROUTE: {
  path: string;
  limiter: string;
  body: () => { question: string; turnstileToken: string };
};
export const SELF_TEST_CASES: [string, () => Result, Level][];
export function isAccessRedirect(status: number, location: string | null | undefined): boolean;
export function judgeAccessGate(status: number, location: string | null | undefined): Result;
export function judgePage(
  page: NavPage,
  status: number,
  contentType: string | null | undefined,
  location: string | null | undefined,
): Result;
export function parseHeadersFile(text: string): [string, string][];
export function judgeHeaders(expected: [string, string][], actual: HeaderSource, where: string): Result[];
export function formOutcome(status: number, location: string | null | undefined): string;
export function judgeFormToken(route: FormRoute, status: number, location: string | null | undefined): Result;
export function judgeAskToken(status: number, body: unknown): Result;
export function judgeBurst(path: string, outcomes: string[], limit: number): Result;
export function judgeRedirects(code: number, lines: string[]): Result;
export interface FragmentTarget {
  page: string;
  id: string;
}
export function fragmentTargets(rows: { to: string }[]): FragmentTarget[];
export function judgeAnchor(target: FragmentTarget, status: number, html: string | null | undefined): Result;
export function rateLimits(config: unknown, envName?: string): Record<string, number | undefined>;
export function exitCode(results: Result[]): 0 | 1 | 3;
export function tally(results: Result[]): string;
export function runSelfTest(): string[];
