// Runs the repo's content gate over files staged at their repo paths.
// One definition, many call sites: this shells out to 04_tools/cs_site_lint.py
// with the real rules file, the same way the hooks and CI do, and never
// carries a copy of a rule.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { recordYaml } from "./yaml.mjs";

const LINE = /^(.+?):(\d+): (FAIL|WARN) \[([^\]]+)\] (.*)$/;

/**
 * Ids of the site's term rules (not voice_lint's prose rules): the public
 * rules file plus the private overlay when it is present, the same files
 * cs_site_lint.py merges. CS_SITE_PRIVATE_RULES names another overlay and
 * must exist; set but empty is an error. While the required-overlay marker
 * (04_tools/.private-overlay-required, or one beside a named overlay) exists,
 * a missing overlay, or one short of the marker's unique-id floors or
 * required_ids, is an error
 * too (#624).
 */
export function termRuleIds(repoRoot, env = process.env) {
  const json = (file) => JSON.parse(readFileSync(file, "utf8"));
  const publicFile = path.join(repoRoot, "04_tools/cs_site_rules.json");
  const ruleIds = (file, parsed) => {
    if (!Array.isArray(parsed.rules)) throw new Error(`${file}: "rules" is not an array`);
    if (file !== publicFile && parsed.rules.length === 0) throw new Error(`${file}: an empty overlay is never meant`);
    const shared = parsed.shared_ids ?? [];
    if (!Array.isArray(shared)) throw new Error(`${file}: "shared_ids" is not an array`);
    return [...parsed.rules.map((r) => r.id), ...shared];
  };
  const named = env.CS_SITE_PRIVATE_RULES;
  if (named === "") throw new Error("CS_SITE_PRIVATE_RULES is set but empty");
  const overlay = named ?? path.join(repoRoot, "04_tools/cs_site_rules.private.json");
  const markers = [path.join(repoRoot, "04_tools/.private-overlay-required")];
  if (named !== undefined) markers.push(path.join(path.dirname(path.resolve(named)), ".private-overlay-required"));
  const marker = markers.find((m) => existsSync(m));
  const ids = ruleIds(publicFile, json(publicFile));
  if (named === undefined && !existsSync(overlay)) {
    if (marker) throw new Error(`${marker} requires the private rules overlay, and ${overlay} is missing`);
    return new Set(ids);
  }
  const parsed = json(overlay);
  const privateIds = ruleIds(overlay, parsed);
  if (marker) {
    // The same floor as cs_site_lint.py overlay_shortfall(): unique ids, and every required id (#667).
    const mark = json(marker);
    const ruleIds = new Set(parsed.rules.map((r) => r.id));
    const sharedIds = new Set(parsed.shared_ids ?? []);
    const short = [];
    if (ruleIds.size < (mark.min_rules ?? 0)) short.push(`${ruleIds.size} unique rule ids, want at least ${mark.min_rules}`);
    if (sharedIds.size < (mark.min_shared_ids ?? 0)) short.push(`${sharedIds.size} unique shared ids, want at least ${mark.min_shared_ids}`);
    const missing = (mark.required_ids ?? []).filter((id) => !ruleIds.has(id));
    if (missing.length) short.push(`required ids missing: ${missing.join(", ")}`);
    if (short.length) throw new Error(`${overlay} is short of ${marker}: ${short.join("; ")}`);
  }
  return new Set([...ids, ...privateIds]);
}

/** Parses cs_site_lint.py output into findings per record id. */
export function parseLintOutput(stdout) {
  /** @type {Map<string, { severity: string, check: string, message: string, line: number }[]>} */
  const byId = new Map();
  for (const line of String(stdout).split("\n")) {
    const m = LINE.exec(line.trim());
    if (!m) continue;
    const id = path.basename(m[1]).replace(/\.ya?ml$/, "");
    const list = byId.get(id) ?? [];
    list.push({ severity: m[3], check: m[4], message: m[5], line: Number(m[2]) });
    byId.set(id, list);
  }
  return byId;
}

export class CouldNotLint extends Error {}

const CHECKED = /^cs_site_lint: (\d+) file\(s\) checked/m;

/**
 * Runs the gate over files staged in a temp root, at the repo paths they
 * would have. Throws CouldNotLint unless the gate ran to the end and read
 * every file: no python, a signal (status null), any exit but 0 or 1, an
 * INFRA line (exit 1 can carry one when a FAIL hides a partial check), or
 * fewer files checked than given (a scope change that skipped them would
 * otherwise read as clean).
 * @param {{ rel: string, text: string }[]} staged
 * @param {{ repoRoot: string, python?: string, today?: string }} options
 */
export function lintStaged(staged, { repoRoot, python = "python3", today }) {
  if (staged.length === 0) return new Map();
  const root = mkdtempSync(path.join(tmpdir(), "cs-lint-"));
  try {
    const files = staged.map(({ rel, text }) => {
      const abs = path.join(root, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, text);
      return abs;
    });
    const args = [path.join(repoRoot, "04_tools/cs_site_lint.py"), "--root", root];
    if (today) args.push("--today", today);
    const run = spawnSync(python, [...args, ...files], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (run.error) throw new CouldNotLint(`could not run ${python}: ${run.error.message}`);
    const stderr = String(run.stderr ?? "").trim();
    if (run.status !== 0 && run.status !== 1) {
      const how = run.status === null ? `was killed by ${run.signal}` : `exited ${run.status}`;
      throw new CouldNotLint(`cs_site_lint.py ${how}: ${stderr}`);
    }
    if (/^INFRA:/m.test(stderr)) throw new CouldNotLint(`cs_site_lint.py could not check everything: ${stderr}`);
    const checked = Number(CHECKED.exec(run.stdout)?.[1] ?? -1);
    if (checked !== files.length) {
      throw new CouldNotLint(`cs_site_lint.py checked ${checked < 0 ? "no" : checked} of ${files.length} files`);
    }
    return parseLintOutput(run.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Lints records as if they were already in data/resources/.
 * @param {{ id: string, stage: string }[]} records
 * @param {{ repoRoot: string, python?: string, today?: string }} options
 */
export function lintRecords(records, options) {
  const staged = records.map((r) => ({ rel: path.join("data", "resources", r.stage, `${r.id}.yaml`), text: recordYaml(r) }));
  return lintStaged(staged, options);
}
