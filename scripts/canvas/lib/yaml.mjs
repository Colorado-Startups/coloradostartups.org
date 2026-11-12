// The repo's one YAML writer for generated data files: resource records here,
// and data/positions/ (scripts/positions/sync-volunteers.mjs).

import { Document, visit } from "yaml";

export const FIELD_ORDER = [
  "id",
  "name",
  "url",
  "stage",
  "substage",
  "city",
  "type",
  "description",
  "tags",
  "source",
  "status",
  "last_checked",
  "added",
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * YAML for one value, after an optional comment header. Astro's YAML loader
 * and YAML 1.1 readers read a bare 2026-10-08 as a timestamp, and the schemas
 * want the string, so every date-shaped string is quoted. The yaml package
 * already quotes strings that look like numbers, such as "3" or "1954".
 * @param {unknown} value
 * @param {string[]} [header] comment lines, without the "# "
 */
export function toYaml(value, header = []) {
  const doc = new Document(value);
  visit(doc, {
    Scalar(_key, node) {
      if (typeof node.value === "string" && DATE.test(node.value)) node.type = "QUOTE_DOUBLE";
    },
  });
  return header.map((line) => `# ${line}\n`).join("") + doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

/** One resource record, keys in ResourceSchema order, so every record file reads the same way. */
export function recordYaml(record) {
  const ordered = {};
  for (const key of FIELD_ORDER) if (record[key] !== undefined) ordered[key] = record[key];
  return toYaml(ordered);
}
