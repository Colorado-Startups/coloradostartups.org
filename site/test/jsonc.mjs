// The one JSONC reader for the test suites (issues #365 and #395). It takes
// text and never touches the disk, so the worker project (inside workerd, text
// from a `?raw` import), the unit project (in Node, text from readFileSync) and
// the live smoke test (plain Node, site/test/live/smoke-lib.mjs) share it.
// Plain JavaScript so Node runs it directly; jsonc.d.mts types it for the
// TypeScript tests.
//
// JSONC here is JSON plus `//` and `/* */` comments and trailing commas, the
// way wrangler.jsonc is written. Two passes, both string-aware, so comment
// markers and commas inside strings ("/api/*", "https://...") stay put:
//   1. Blank out comments.
//   2. Blank out each comma whose next non-space character is `]` or `}`.
// Comments go first, so a trailing comma followed by a comment before the
// bracket is still trailing in pass 2.
//
// Both passes overwrite with spaces (newlines kept) instead of deleting, so a
// JSON.parse error position still points into the original text.

// The index of the quote that closes the string opening at `start`, or the
// last index when the string never closes. A backslash skips the character
// after it, so `\"` and `\\` are both handled.
function stringEnd(text, start) {
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === "\\") i += 1;
    else if (text[i] === '"') return i;
  }
  return text.length - 1;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function blank(span) {
  return span.replace(/[^\n]/g, " ");
}

function stripComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end + 1);
      i = end + 1;
    } else if (ch === "/" && text[i + 1] === "/") {
      const newline = text.indexOf("\n", i);
      const end = newline < 0 ? text.length : newline;
      out += blank(text.slice(i, end));
      i = end;
    } else if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      if (close < 0) throw new SyntaxError(`JSONC: unclosed /* comment opened on line ${lineOf(text, i)}`);
      out += blank(text.slice(i, close + 2));
      i = close + 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

function stripTrailingCommas(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end + 1);
      i = end + 1;
    } else {
      out += ch === "," && /^\s*[\]}]/.test(text.slice(i + 1)) ? " " : ch;
      i += 1;
    }
  }
  return out;
}

export function parseJsonc(text) {
  return JSON.parse(stripTrailingCommas(stripComments(text)));
}
