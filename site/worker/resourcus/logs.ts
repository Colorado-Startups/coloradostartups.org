// ask_logs: one row per answered question. What is kept: the question, the
// answer, cited ids, dropped ids, mode, reason, model, caller, and a caller
// key. The caller key is a SHA-256 of the web session id or the salted Slack
// hash Communitas already sends. No IP address is ever stored.
//
// Retention: 90 days by default (PLAN.md, D1). purgeResourcusData() deletes
// older rows; the weekly cron that calls it is wired by the orchestrator in
// worker/index.ts and wrangler.jsonc.

import type { AskResponse } from "@cs/shared";

import { errText } from "../lib/errors";
import { sha256Hex } from "./session";

export const ASK_LOG_RETENTION_DAYS = 90;
const SESSION_RETENTION_DAYS = 1;

export interface AskLogRow {
  caller: "web" | "slack";
  callerKey?: string;
  question: string;
  response: AskResponse;
  model: string | null;
  dropped: string[];
}

async function callerKeyFor(caller: "web" | "slack", key: string | undefined): Promise<string | null> {
  if (!key) return null;
  // Slack keys arrive hashed and salted by Communitas; web session ids are
  // hashed here so a log row cannot be replayed as a verified session.
  return caller === "slack" ? key : (await sha256Hex(`web:${key}`)).slice(0, 32);
}

// Writes one ask_logs row: question, answer, citations, mode and model. A web
// session id is hashed first. Best effort: a failed insert is logged, never
// thrown.
export async function recordAsk(db: D1Database | undefined, row: AskLogRow, now = new Date()): Promise<void> {
  if (!db) return;
  try {
    await db
      .prepare(
        `INSERT INTO ask_logs (created_at, caller, caller_key, question, answer, citations, mode, reason, model, dropped_citations)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        now.toISOString(),
        row.caller,
        await callerKeyFor(row.caller, row.callerKey),
        row.question,
        row.response.answer,
        JSON.stringify(row.response.citations),
        row.response.mode,
        row.response.reason,
        row.model,
        row.dropped.length > 0 ? JSON.stringify(row.dropped) : null,
      )
      .run();
  } catch (err) {
    // Best effort: a logging hiccup never costs the visitor an answer.
    console.error("ask_logs insert failed:", errText(err));
  }
}

export interface PurgeResult {
  logs: number;
  sessions: number;
}

// The weekly retention job: deletes ask_logs rows past ASK_LOG_RETENTION_DAYS
// and ask_sessions rows past SESSION_RETENTION_DAYS. Returns both counts.
export async function purgeResourcusData(db: D1Database, now = new Date()): Promise<PurgeResult> {
  const day = 86_400_000;
  const logCutoff = new Date(now.getTime() - ASK_LOG_RETENTION_DAYS * day).toISOString();
  const sessionCutoff = new Date(now.getTime() - SESSION_RETENTION_DAYS * day).toISOString();
  const [logs, sessions] = await db.batch([
    db.prepare("DELETE FROM ask_logs WHERE created_at < ?").bind(logCutoff),
    db.prepare("DELETE FROM ask_sessions WHERE verified_at < ?").bind(sessionCutoff),
  ]);
  return { logs: logs?.meta.changes ?? 0, sessions: sessions?.meta.changes ?? 0 };
}
