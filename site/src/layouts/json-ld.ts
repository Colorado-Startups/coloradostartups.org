// The text inside BaseLayout's <script type="application/ld+json">.
// Orchestrator-owned, with BaseLayout.astro.
//
// A script element's text ends at the first "</script", whatever the JSON
// around it says, so a title or summary carrying "</script>" could close the
// tag and inject markup. JSON.stringify leaves "<" alone. Writing it as the
// JSON escape \u003c keeps the value identical for any JSON parser and leaves
// no "<" in the text, which also rules out "<!--".
// test/unit/l15/json-ld.test.ts and test/dom/l15/head.test.ts prove both.
export function jsonLdText(value: Record<string, unknown>): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
