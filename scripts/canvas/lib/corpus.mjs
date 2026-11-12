// The Resourcus corpus: one markdown document per active resource, uploaded
// to the AI Search instance's built-in storage through the Items API.
//
// Contract with L4 (worker/resourcus/ai-search.ts):
//   key       cs-resource--<id>--<hash>.md, where <hash> is the first 16 hex
//             characters of the SHA-256 of the document text. The id sits
//             between the two "--" separators; SlugSchema forbids "--" inside
//             an id, so the split is unambiguous. Keys stay under the API's
//             128-character filename limit (80 + 34).
//   metadata  resource_id, stage, type, city. Filtering by them needs those
//             fields defined on the instance first; until then the API
//             accepts the upload and returns a warning, which sync reports.
//   text      name, description, type, stage, substage, city and tags. No
//             URL: the model never sees a link, so it cannot repeat one, and
//             the UI builds every card from /data/resources.json.
//
// Upserting by content hash: a changed record gets a new key, so sync uploads
// the new document and then deletes the old key. Unchanged records cost
// nothing. Any key with the prefix that no active record produces is an
// orphan and is deleted. Keys without the prefix are never touched.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";

export const KEY_PREFIX = "cs-resource--";
const KEY_RE = /^cs-resource--([a-z0-9]+(?:-[a-z0-9]+)*)--([0-9a-f]{16})\.md$/;
const MAX_KEY = 128;

const STAGE_WORDS = {
  idea: "Idea stage",
  launch: "Launch stage",
  growth: "Growth stage",
  support: "Support at any stage",
};

/** Reads every record file under data/resources/. */
export function readRecords(dataDir) {
  const out = [];
  for (const stage of readdirSync(dataDir, { withFileTypes: true })) {
    if (!stage.isDirectory()) continue;
    for (const f of readdirSync(path.join(dataDir, stage.name)).sort()) {
      if (!/\.ya?ml$/.test(f)) continue;
      out.push(parse(readFileSync(path.join(dataDir, stage.name, f), "utf8")));
    }
  }
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

const REQUIRED = ["id", "name", "stage", "substage", "city", "type", "description"];

/** The markdown text Resourcus retrieves for one record. */
export function documentText(r) {
  const lines = [
    `# ${r.name}`,
    "",
    r.description,
    "",
    `- Type: ${r.type}`,
    `- Stage: ${STAGE_WORDS[r.stage] ?? r.stage} (${r.substage})`,
    `- City: ${r.city}`,
  ];
  if (r.tags?.length) lines.push(`- Tags: ${r.tags.join(", ")}`);
  lines.push(`- Resource id: ${r.id}`);
  return `${lines.join("\n")}\n`;
}

export function hashText(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

export function keyFor(id, hash) {
  return `${KEY_PREFIX}${id}--${hash}.md`;
}

/** The id a corpus key belongs to, or null for a key this sync does not own. */
export function idFromKey(key) {
  const m = KEY_RE.exec(key);
  return m ? m[1] : null;
}

/**
 * The documents the instance should hold: active records only.
 * @returns {{ key: string, id: string, text: string, metadata: Record<string, string> }[]}
 */
export function buildDocuments(records) {
  const docs = [];
  const seen = new Set();
  for (const r of records) {
    if ((r.status ?? "active") !== "active") continue;
    const missing = REQUIRED.filter((k) => !r[k]);
    if (missing.length > 0) throw new Error(`record ${r.id ?? "?"} is missing ${missing.join(", ")}`);
    if (seen.has(r.id)) throw new Error(`duplicate record id ${r.id}`);
    seen.add(r.id);
    const text = documentText(r);
    const key = keyFor(r.id, hashText(text));
    if (key.length > MAX_KEY) throw new Error(`key for ${r.id} is ${key.length} characters, over ${MAX_KEY}`);
    docs.push({
      key,
      id: r.id,
      text,
      metadata: { resource_id: r.id, stage: r.stage, type: r.type, city: r.city },
    });
  }
  return docs;
}

/**
 * What a sync would change, in the order it runs:
 *   1. retry:  delete our items that failed to index, so they can be re-sent
 *   2. upload: every wanted document the instance lacks (including retries)
 *   3. remove: delete orphans, only after the uploads, so a changed resource
 *              is never missing from search while it is replaced
 * @template {{ key: string }} D
 * @param {D[]} desired
 * @param {{ id: string, key: string, status?: string }[]} remote every item in the instance
 */
export function planSync(desired, remote) {
  const ours = remote.filter((item) => item.key.startsWith(KEY_PREFIX));
  const byKey = new Map(ours.map((item) => [item.key, item]));
  const wanted = new Set(desired.map((d) => d.key));
  const retry = ours.filter((item) => wanted.has(item.key) && item.status === "error");
  const upload = desired.filter((d) => !byKey.has(d.key) || byKey.get(d.key)?.status === "error");
  const remove = ours.filter((item) => !wanted.has(item.key));
  return { retry, upload, remove, unchanged: desired.length - upload.length, ignored: remote.length - ours.length };
}
