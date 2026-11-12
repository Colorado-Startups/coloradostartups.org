// POST /api/suggest-resource: suggestions into D1 `resource_suggestions`.
// Owner: L3. No Worker ever fetches the suggested URL; it is stored as text,
// and link checks run offline in scripts/canvas/ when someone promotes a
// suggestion into a data PR (runbook ops/runbooks/promote-submissions.md).
//
// Pipeline (worker/lib/forms.ts): formIntake (rate limit -> parse ->
// honeypot -> speed check) -> validate -> turnstileError -> store in D1 ->
// 303 to the thanks page, with the notice to Paul sent after the response
// (best effort). D1 is the record, so a failed insert tells the visitor; a
// failed email does not.

import { parseWebLink, STAGES } from "@cs/shared";

import { FIELD_LIMITS } from "../lib/config";
import { formIntake, makeSafeReturnTo, redirect, turnstileError, type FormError } from "../lib/forms";
import { notify } from "../lib/notify";
import { isPlausibleEmail, singleLine } from "../lib/validate";

const SUGGEST_PATH = "/api/suggest-resource";
const SUGGEST_FORM_PATH = "/ecosystem-canvas/suggest/";
const SUGGEST_THANKS_PATH = "/ecosystem-canvas/suggest/thanks/";
const CITY_MAX = 60;

// Where an error may send the visitor back to. Anything else falls back to
// the form itself.
const safeReturnTo = makeSafeReturnTo([SUGGEST_FORM_PATH, "/ecosystem-canvas/"], SUGGEST_FORM_PATH);

export interface Suggestion {
  name: string;
  url: string;
  stage: (typeof STAGES)[number] | null;
  city: string | null;
  note: string | null;
  email: string | null;
}

// Letters, digits, punctuation, spaces and newlines. Other control
// characters never belong in a note.
function cleanNote(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

// A web address as typed: the scheme is added when missing ("acme.co"). It
// must be http or https, have a dotted host, and carry no user or password.
// Unlike an applicant's links, it may carry a port and spaces in its path.
// Parsing is the only thing done with it.
export function normalizeSuggestedUrl(raw: string): string | null {
  return parseWebLink(singleLine(raw), {
    max: FIELD_LIMITS.url,
    addScheme: true,
    allowHttp: true,
    allowPort: true,
    allowWhitespace: true,
  });
}

/** Validates the visitor's fields. Returns null when anything is invalid. */
export function parseSuggestion(form: FormData): Suggestion | null {
  const text = (key: string) => {
    const v = form.get(key);
    return typeof v === "string" ? v : "";
  };
  const name = singleLine(text("name"));
  if (name.length === 0 || name.length > FIELD_LIMITS.name) return null;

  const url = normalizeSuggestedUrl(text("url"));
  if (!url) return null;

  const stageRaw = singleLine(text("stage"));
  let stage: Suggestion["stage"] = null;
  if (stageRaw) {
    if (!(STAGES as readonly string[]).includes(stageRaw)) return null;
    stage = stageRaw as Suggestion["stage"];
  }

  const city = singleLine(text("city"));
  if (city.length > CITY_MAX) return null;

  const note = cleanNote(text("note"));
  if (note.length > FIELD_LIMITS.longText) return null;

  const email = singleLine(text("email"));
  if (email && (email.length > FIELD_LIMITS.email || !isPlausibleEmail(email))) return null;

  return { name, url, stage, city: city || null, note: note || null, email: email || null };
}

// The notification carries the name, the link and the row id only. The
// suggester's email stays in D1, where triage clears it, so no copy sits in
// an inbox.
function noteBody(s: Suggestion, rowId: number | null): string {
  return [
    "A visitor suggested a resource for the Ecosystem Canvas.",
    "",
    `Name: ${s.name}`,
    `Link (not visited by the site): ${s.url}`,
    `Row: resource_suggestions id ${rowId ?? "unknown"}`,
    "",
    "Read the full row in D1 and follow ops/runbooks/promote-submissions.md.",
  ].join("\n");
}

export { noteBody };

// Takes one resource suggestion form post. Answers 303: to the thanks page, or
// back to the form with ?error=<reason>.
export async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const intake = await formIntake(request, env, {
    path: SUGGEST_PATH,
    formPath: SUGGEST_FORM_PATH,
    thanksPath: SUGGEST_THANKS_PATH,
    returnTo: (form) => safeReturnTo(form.get("return_to")),
  });
  if (intake instanceof Response) return intake;
  const { url, form, returnTo } = intake;
  const back = (error: FormError) => redirect(url, returnTo, error);

  const suggestion = parseSuggestion(form);
  if (!suggestion) return back("invalid");

  const botCheck = await turnstileError(form, request, env);
  if (botCheck) return back(botCheck);

  let rowId: number | null = null;
  try {
    const result = await env.DB.prepare(
      `INSERT INTO resource_suggestions (created_at, status, name, url, note, submitter_email, stage, city)
       VALUES (?, 'new', ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        new Date().toISOString(),
        suggestion.name,
        suggestion.url,
        suggestion.note,
        suggestion.email,
        suggestion.stage,
        suggestion.city,
      )
      .run();
    rowId = typeof result.meta?.last_row_id === "number" ? result.meta.last_row_id : null;
  } catch (err) {
    console.error("suggest-resource not stored:", err instanceof Error ? err.message : err);
    return back("delivery");
  }

  // The visitor does not wait on the email.
  ctx.waitUntil(notify(env.FORM_EMAIL, `Resource suggestion: ${suggestion.name}`, noteBody(suggestion, rowId)));
  return redirect(url, SUGGEST_THANKS_PATH);
}
