// Runs the repo's content gate over event text before any of it reaches the
// snapshot. One definition, many call sites: this shells out to
// 04_tools/cs_site_lint.py with the real rules file, the way the hooks and CI
// do, and never carries a copy of a rule. The runner, the output parser and
// the term-rule ids come from scripts/canvas/lib/lint.mjs, so the
// could-not-check rules live in one place.

import path from "node:path";

import { stringify } from "yaml";

import { CouldNotLint, lintStaged, termRuleIds } from "../../canvas/lib/lint.mjs";

export { CouldNotLint, termRuleIds };

/**
 * One event source as the gate reads it. The title is line 1 and the
 * location line 2, so a finding's line says which field it came from. The
 * url sits under a skipped key, so only the link rules (coloradoai.us, local
 * paths) read it, as they do for a resource's url.
 */
function stageText(source) {
  return stringify(
    { title: source.title, location: source.location, url: source.url, description: source.description || "" },
    { lineWidth: 0 },
  );
}

/** Lines of stageText that the page shows (title and location). */
const SHOWN_LINES = new Set([1, 2]);

/**
 * Lints event sources as if they lived in data/events/. Throws CouldNotLint
 * when the gate could not check them all (lintStaged says when).
 * @param {{ title: string, location: string | null, url: string | null, description: string }[]} sources
 * @param {{ repoRoot: string, python?: string, today?: string }} options
 * @returns {Map<string, { severity: string, check: string, message: string, line: number }[]>} findings by source index
 */
export function lintSources(sources, options) {
  const staged = sources.map((s, i) => ({ rel: path.join("data", "events", `${i}.yaml`), text: stageText(s) }));
  return lintStaged(staged, options);
}

/**
 * Why a source stays off the page, or null to keep it. Any term-rule finding,
 * FAIL or WARN, drops it. The text comes from outside, and no person reads it
 * before a scheduled build publishes it. A prose FAIL (an em dash) drops it only on a line the
 * page shows; the description is never shown.
 * @param {{ severity: string, check: string, line: number }[]} findings
 * @param {Set<string>} termIds
 */
export function dropReason(findings, termIds) {
  const hits = findings.filter(
    (f) => termIds.has(f.check) || (f.severity === "FAIL" && SHOWN_LINES.has(f.line)),
  );
  if (hits.length === 0) return null;
  return [...new Set(hits.map((f) => `${f.check} (${f.severity})`))].join(", ");
}
