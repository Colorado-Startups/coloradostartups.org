// The AI-visibility panel: questions, scoring and the summary.
// Pure TypeScript with no I/O, so test/ checks it directly. cli.ts reads and
// writes files; providers.ts talks to the three APIs.
//
// What one answer is scored on (REPORT.md "What is measured"):
//   named   the answer text says "Colorado Startups" (case-sensitive),
//           "ColoradoStartups" or coloradostartups.org
//   cited   the provider's citation list, or a link or bare domain in the
//           text, points at coloradostartups.org or a subdomain
//   position  where the first mention sits: its character offset, and its
//           rank among the things the answer lists (see locate())

import { z } from "zod";

import type { ProviderId, Usage } from "./cost.ts";
import { usd } from "./cost.ts";

export const BRAND = "Colorado Startups";
export const DOMAIN = "coloradostartups.org";

// ---------- questions ----------

export const TOPICS = ["community", "founders", "resources", "lookup", "accelerators", "region", "events"] as const;
export const REGIONS = ["statewide", "denver-boulder", "colorado-springs", "fort-collins"] as const;

const QuestionSchema = z
  .object({
    id: z.string().regex(/^v\d{2}$/),
    topic: z.enum(TOPICS),
    region: z.enum(REGIONS),
    question: z.string().min(10).max(400),
  })
  .strict();
export type Question = z.infer<typeof QuestionSchema>;

// A question that names us measures nothing. One that says "Colorado
// startups" invites an answer whose title-case heading reads as our name.
const NOT_IN_QUESTIONS = [/colorado\s+startups/i, /coloradostartups/i];

export function parseQuestions(raw: unknown): Question[] {
  const list = z.array(QuestionSchema).min(1).parse(raw);
  const ids = new Set<string>();
  for (const q of list) {
    if (ids.has(q.id)) throw new Error(`duplicate question id ${q.id}`);
    ids.add(q.id);
    if (NOT_IN_QUESTIONS.some((re) => re.test(q.question))) {
      throw new Error(`${q.id} names Colorado Startups or says "Colorado startups"; see questions.yaml`);
    }
  }
  return list;
}

// ---------- links ----------

/** True for coloradostartups.org and any subdomain; false for look-alikes. */
export function isOwnUrl(url: string): boolean {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  return host === DOMAIN || host.endsWith(`.${DOMAIN}`);
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>()[\]"'`]+/gi;

interface UrlSpan {
  start: number;
  end: number;
  url: string;
}

/** URLs written in the answer text, trailing punctuation trimmed. */
function urlSpans(text: string): UrlSpan[] {
  return [...text.matchAll(URL_IN_TEXT)].map((m) => {
    const url = m[0].replace(/[.,;:!?*_]+$/, "");
    return { start: m.index, end: m.index + url.length, url };
  });
}

export function linksInText(text: string): string[] {
  return urlSpans(text).map((s) => s.url);
}

/** The text with every URL blanked out, offsets unchanged. */
function withoutUrls(text: string, spans: readonly UrlSpan[]): string {
  let out = text;
  for (const s of spans) out = out.slice(0, s.start) + " ".repeat(s.end - s.start) + out.slice(s.end);
  return out;
}

// The bare domain in prose ("see coloradostartups.org"), not inside a longer
// name such as notcoloradostartups.org or coloradostartups.org.example.net.
const BARE_DOMAIN = /(?<![\w.-])(?:[\w-]+\.)*coloradostartups\.org(?![\w-]|\.[a-z0-9])/i;

// ---------- mentions ----------

// Case-sensitive on purpose: "Colorado startups" is the generic phrase,
// "Colorado Startups" is the organization. No line breaks inside the name.
// The domain counts as a name too, in prose or in one of our own URLs, but
// not inside a look-alike host or another site's URL.
const NAME_PATTERNS = [
  /\bColorado[ \t\u00a0]+Startups\b/g,
  /\bColoradoStartups\b/g,
  /\bcoloradostartups\.org(?![\w-]|\.[a-z0-9])/gi,
];

export interface Mention {
  offset: number;
  match: string;
  /** About 60 characters either side, whitespace collapsed, for a person to check. */
  snippet: string;
}

export function findMentions(text: string): Mention[] {
  const urls = urlSpans(text);
  const inForeignUrl = (offset: number) => urls.some((u) => offset >= u.start && offset < u.end && !isOwnUrl(u.url));
  const hits: { offset: number; end: number; match: string }[] = [];
  for (const re of NAME_PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (inForeignUrl(m.index)) continue;
      hits.push({ offset: m.index, end: m.index + m[0].length, match: m[0] });
    }
  }
  hits.sort((a, b) => a.offset - b.offset || b.end - a.end);
  const out: Mention[] = [];
  let lastEnd = -1;
  for (const h of hits) {
    // "ColoradoStartups.org" matches two patterns; keep the first span only.
    if (h.offset < lastEnd) continue;
    lastEnd = h.end;
    const snippet = text
      .slice(Math.max(0, h.offset - 60), h.end + 60)
      .replace(/\s+/g, " ")
      .trim();
    out.push({ offset: h.offset, match: h.match, snippet });
  }
  return out;
}

// ---------- position ----------

export type UnitKind = "list" | "heading" | "paragraph";

export interface Position {
  /** Character offset of the first mention in the answer text. */
  offset: number;
  /** offset / text length, two decimals. 0 is the very start. */
  share: number;
  /** 1-based rank of the unit holding the first mention. */
  rank: number;
  /** How many units the answer has. */
  units: number;
  unit: UnitKind;
  /** The mention comes before the first unit, in the lead above a list or heading. */
  inLead: boolean;
}

const LIST_LINE = /^([ \t]*)(?:[-*+•]|\d{1,3}[.)])[ \t]+\S/;
const HEADING_LINE = /^[ \t]{0,3}#{1,6}[ \t]+\S/;

interface Line {
  start: number;
  text: string;
  indent: number;
  blank: boolean;
}

function splitLines(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (const raw of text.split("\n")) {
    out.push({ start, text: raw, indent: /^[ \t]*/.exec(raw)?.[0].length ?? 0, blank: raw.trim() === "" });
    start += raw.length + 1;
  }
  return out;
}

interface Span {
  start: number;
  end: number;
}

// Top-level list items only, so a nested bullet stays part of its parent. An
// item ends at the next top-level item, at a heading, or at an unindented
// paragraph after a blank line (prose after the list is not in the last item).
function listSpans(lines: Line[], length: number): Span[] {
  const items = lines.filter((l) => LIST_LINE.test(l.text));
  if (items.length === 0) return [];
  const top = Math.min(...items.map((l) => l.indent));
  const spans: Span[] = [];
  let open: number | null = null;
  let prevBlank = false;
  for (const l of lines) {
    const isItem = LIST_LINE.test(l.text);
    if (isItem && l.indent <= top + 1) {
      if (open !== null) spans.push({ start: open, end: l.start });
      open = l.start;
    } else if (open !== null && !l.blank && (HEADING_LINE.test(l.text) || (prevBlank && !isItem && l.indent <= top))) {
      spans.push({ start: open, end: l.start });
      open = null;
    }
    prevBlank = l.blank;
  }
  if (open !== null) spans.push({ start: open, end: length });
  return spans;
}

function headingSpans(lines: Line[], length: number): Span[] {
  const starts = lines.filter((l) => HEADING_LINE.test(l.text)).map((l) => l.start);
  return starts.map((start, i) => ({ start, end: starts[i + 1] ?? length }));
}

function paragraphSpans(lines: Line[], length: number): Span[] {
  const spans: Span[] = [];
  let open: number | null = null;
  for (const l of lines) {
    if (l.blank) {
      if (open !== null) spans.push({ start: open, end: l.start });
      open = null;
    } else if (open === null) {
      open = l.start;
    }
  }
  if (open !== null) spans.push({ start: open, end: length });
  return spans;
}

/**
 * Where an offset sits among the things an answer lists. The units are its
 * top-level list items; with no list, its headings; with neither, its
 * paragraphs. A mention in the lead above the first unit ranks 1, because the
 * answer put it ahead of everything it went on to list. A mention after a
 * unit ends but before the next one ranks after it.
 */
export function locate(text: string, offset: number): Position {
  const lines = splitLines(text);
  let unit: UnitKind = "list";
  let spans = listSpans(lines, text.length);
  if (spans.length === 0) {
    unit = "heading";
    spans = headingSpans(lines, text.length);
  }
  if (spans.length === 0) {
    unit = "paragraph";
    spans = paragraphSpans(lines, text.length);
  }
  const inside = spans.findIndex((s) => offset >= s.start && offset < s.end);
  const before = spans.filter((s) => s.start <= offset).length;
  const share = text.length > 0 ? Math.round((offset / text.length) * 100) / 100 : 0;
  return {
    offset,
    share,
    rank: inside >= 0 ? inside + 1 : before + 1,
    units: spans.length,
    unit,
    inLead: before === 0,
  };
}

// ---------- one answer ----------

export type CitedVia = "citation" | "text";

export interface Score {
  named: boolean;
  cited: boolean;
  citedVia: CitedVia[];
  /** The coloradostartups.org URLs the answer cites or links. */
  ownUrls: string[];
  /** True when the first mention ranks 1 (see locate()). */
  namedFirst: boolean;
  position: Position | null;
  mentions: Mention[];
}

export function scoreAnswer(text: string, citedUrls: readonly string[]): Score {
  const mentions = findMentions(text);
  const first = mentions[0];
  const position = first ? locate(text, first.offset) : null;
  const urls = urlSpans(text);
  const fromCitations = citedUrls.filter(isOwnUrl);
  const fromText = urls.map((u) => u.url).filter(isOwnUrl);
  const citedVia: CitedVia[] = [];
  if (fromCitations.length > 0) citedVia.push("citation");
  if (fromText.length > 0 || BARE_DOMAIN.test(withoutUrls(text, urls))) citedVia.push("text");
  return {
    named: mentions.length > 0,
    cited: citedVia.length > 0,
    citedVia,
    ownUrls: [...new Set([...fromCitations, ...fromText])],
    namedFirst: position?.rank === 1,
    position,
    mentions,
  };
}

// ---------- results ----------

export interface AnswerRecord {
  id: string;
  topic: Question["topic"];
  region: Question["region"];
  question: string;
  text: string;
  citedUrls: string[];
  searchResultUrls: string[];
  stopReason: string | null;
  usage: Usage;
  costUsd: number;
  latencyMs: number;
  error: string | null;
  score: Score | null;
}

export interface ProviderSummary {
  provider: ProviderId;
  model: string;
  questions: number;
  answered: number;
  errors: number;
  named: number;
  cited: number;
  namedFirst: number;
  /** Median rank of the first mention, over named answers. */
  medianRank: number | null;
  searches: number;
  costUsd: number;
}

export interface ResultsFile {
  panel: "ai-visibility";
  version: 1;
  date: string;
  provider: ProviderId;
  model: string;
  startedAt: string;
  finishedAt: string;
  pricing: { source: string; read: string };
  summary: ProviderSummary;
  answers: AnswerRecord[];
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function summarize(provider: ProviderId, model: string, answers: readonly AnswerRecord[]): ProviderSummary {
  const ok = answers.filter((a) => a.error === null && a.score !== null);
  return {
    provider,
    model,
    questions: answers.length,
    answered: ok.length,
    errors: answers.length - ok.length,
    named: ok.filter((a) => a.score!.named).length,
    cited: ok.filter((a) => a.score!.cited).length,
    namedFirst: ok.filter((a) => a.score!.namedFirst).length,
    medianRank: median(ok.flatMap((a) => (a.score!.position ? [a.score!.position.rank] : []))),
    searches: answers.reduce((n, a) => n + a.usage.searches, 0),
    costUsd: answers.reduce((n, a) => n + a.costUsd, 0),
  };
}

/**
 * Re-score recorded answers, for a scorer change, with no API calls. Costs
 * stay as recorded: they are what the run cost at that day's prices.
 */
export function rescore(file: ResultsFile): ResultsFile {
  const answers = file.answers.map((a) => ({
    ...a,
    score: a.error === null ? scoreAnswer(a.text, a.citedUrls) : null,
  }));
  return { ...file, answers, summary: summarize(file.provider, file.model, answers) };
}

// ---------- summary markdown ----------

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function cell(a: AnswerRecord | undefined): string {
  if (!a) return "";
  if (a.error !== null || !a.score) return "error";
  const s = a.score;
  const parts: string[] = [];
  if (s.named) parts.push(`named #${s.position?.rank ?? "?"}`);
  if (s.cited) parts.push("cited");
  return parts.length > 0 ? parts.join(", ") : "no";
}

function count(n: number, of: number): string {
  return `${n}/${of}`;
}

export interface RunFile {
  /** Repo-relative path, for the Sources list. */
  path: string;
  results: ResultsFile;
}

/** The provider table and the spend line, shared by summary.md and REPORT.md. */
export function providerTable(files: readonly RunFile[], estimatedUsd: number | null): string[] {
  const lines: string[] = [];
  lines.push("| Provider | Model | Named | Cited | Named first | Median rank when named | Errors | Searches | Cost from usage |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  let spent = 0;
  for (const { results } of files) {
    const s = results.summary;
    spent += s.costUsd;
    lines.push(
      `| ${s.provider} | \`${s.model}\` | ${count(s.named, s.questions)} | ${count(s.cited, s.questions)} | ${count(s.namedFirst, s.questions)} | ${s.medianRank ?? "n/a"} | ${s.errors} | ${s.searches} | ${usd(s.costUsd)} |`,
    );
  }
  lines.push("");
  lines.push(
    `Spend: ${usd(spent)}, computed from each provider's usage block at the prices in \`pricing.yaml\`` +
      (estimatedUsd === null ? "." : `. The runner estimated ${usd(estimatedUsd)} before the run.`),
  );
  return lines;
}

/**
 * The summary for one run date. Every figure is a count over the results
 * files it names, so each line carries its source.
 */
export function summaryMarkdown(date: string, files: readonly RunFile[], estimatedUsd: number | null): string {
  const lines: string[] = [];
  const questions = files[0]?.results.answers.length ?? 0;
  lines.push(`# AI-visibility panel, ${date}`, "");
  lines.push(
    `${questions} questions from \`questions.yaml\`, each asked once of ${files.length} provider${files.length === 1 ? "" : "s"} with live web search on.`,
    "Every count below comes from the results files listed under Sources. A cell like `3/20` means 3 of the 20 answers.",
    "",
  );
  lines.push(...providerTable(files, estimatedUsd), "");

  lines.push("## By question", "");
  lines.push("`named #2` means the first mention sits in the answer's second listed item (`panel.ts` `locate()`).", "");
  lines.push(`| Id | Topic | Region | ${files.map((f) => f.results.provider).join(" | ")} |`);
  lines.push(`| --- | --- | --- | ${files.map(() => "---").join(" | ")} |`);
  const byProvider = files.map((f) => new Map(f.results.answers.map((a) => [a.id, a])));
  for (const a of files[0]?.results.answers ?? []) {
    lines.push(`| ${a.id} | ${a.topic} | ${a.region} | ${byProvider.map((m) => cell(m.get(a.id))).join(" | ")} |`);
  }
  lines.push("");

  const domainCounts = new Map<string, number>();
  for (const { results } of files) {
    for (const a of results.answers) {
      const hosts = new Set(a.citedUrls.map(hostOf).filter((h): h is string => h !== null));
      for (const h of hosts) domainCounts.set(h, (domainCounts.get(h) ?? 0) + 1);
    }
  }
  const top = [...domainCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15);
  lines.push("## Most cited domains", "");
  lines.push("Answers that cite the domain at least once, across every provider in this run.", "");
  lines.push("| Domain | Answers |", "| --- | --- |");
  for (const [host, n] of top) lines.push(`| ${host} | ${n} |`);
  if (top.length === 0) lines.push("| none | 0 |");
  lines.push("");

  lines.push("## Sources", "");
  for (const { path, results } of files) {
    lines.push(`- \`${path}\` (${results.provider}, prices read ${results.pricing.read} from ${results.pricing.source})`);
  }
  lines.push("");
  return lines.join("\n");
}
