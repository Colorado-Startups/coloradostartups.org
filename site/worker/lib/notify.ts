// Best-effort notification email to Paul for each new submission. Uses the
// FORM_EMAIL send_email binding, which works only after the DNS cutover (see
// config.ts). Never throws: the D1 row is the record, the email is a nudge.

import { EmailMessage } from "cloudflare:email";

import { FORM_SENDER, NOTIFY_TO, SITE_NAME } from "./config";
import { errText } from "./errors";
import { singleLine } from "./validate";

export interface SendEmailBinding {
  send(message: EmailMessage): Promise<unknown>;
}

// RFC 2045 caps a base64 body line at 76 characters.
const BASE64_LINE = 76;
// RFC 2047 caps an encoded-word at 75 characters: 12 for "=?utf-8?B?" and
// "?=", which leaves 60 of base64, the encoding of 45 bytes.
const WORD_BYTES = 45;

function base64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// Header text, accents included, as RFC 2047 encoded-words of at most 45
// UTF-8 bytes each. A chunk ends between characters, never inside one, and
// the words are folded onto continuation lines.
function encodedWords(text: string): string {
  const chunks = [""];
  let bytes = 0;
  for (const ch of text) {
    const size = new TextEncoder().encode(ch).length;
    if (bytes + size > WORD_BYTES) {
      chunks.push("");
      bytes = 0;
    }
    chunks[chunks.length - 1] += ch;
    bytes += size;
  }
  return chunks.map((c) => `=?utf-8?B?${base64(c)}?=`).join("\r\n ");
}

// The raw RFC 5322 message, written by hand: a plain-text note needs eight
// headers, and a MIME library bundled mime-db's 133 KB of types for them.
// The subject passes through singleLine as a second layer of
// MIME-header-injection defense, on top of the handlers that already clean
// form input. The body is base64, so its newlines are never header
// separators and a long answer never passes the 998-character line limit.
export function buildEmailRaw(subject: string, bodyText: string): string {
  const domain = FORM_SENDER.slice(FORM_SENDER.indexOf("@") + 1);
  // An empty body still gets its line, so a blank line always ends the headers.
  const body = base64(bodyText).match(new RegExp(`.{1,${BASE64_LINE}}`, "g")) ?? [""];
  return [
    `Date: ${new Date().toUTCString().replace(/GMT$/, "+0000")}`,
    `From: ${encodedWords(`${SITE_NAME} website`)} <${FORM_SENDER}>`,
    `To: <${NOTIFY_TO}>`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    `Subject: ${encodedWords(singleLine(subject))}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    ...body,
  ].join("\r\n");
}

// Emails Paul one plain-text notice through the FORM_EMAIL binding. Best effort:
// a missing binding or a failed send is logged, never thrown, so the form still
// succeeds.
export async function notify(binding: SendEmailBinding | undefined, subject: string, bodyText: string): Promise<void> {
  if (!binding) {
    console.log("notify skipped: FORM_EMAIL binding not configured");
    return;
  }
  try {
    await binding.send(new EmailMessage(FORM_SENDER, NOTIFY_TO, buildEmailRaw(subject, bodyText)));
  } catch (err) {
    console.error("notify failed:", errText(err));
  }
}
