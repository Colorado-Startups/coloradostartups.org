// The marks in a built page's HTML, for the Engagement collector
// (engagement.mjs). A mark is a data attribute a control or a card carries:
// data-builder, or data-hotspot=companies for one value.
//
// A small walk over the tags, not a DOM. It is enough for the HTML a site
// build writes, which closes its tags. Each start tag records whether a
// visitor sees it before any click: not inside an element with the hidden
// attribute, and not inside a template, whose content shows only when a
// script copies it.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
// Their text is not markup: a "<" in a script is no tag.
const RAW = new Set(["script", "style", "textarea", "title"]);
const ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", "#39": "'", "#x27": "'" };
const decode = (s) => s.replace(/&(amp|quot|apos|lt|gt|#39|#x27);/g, (_, e) => ENTITIES[e]);

const TAG = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

// A start tag's attributes, by lower-case name; a bare attribute is "".
export function attributes(text) {
  const out = new Map();
  for (const m of text.matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    if (!out.has(name)) out.set(name, decode(m[2] ?? m[3] ?? m[4] ?? ""));
  }
  return out;
}

// Ends the newest open element named `name`, and any left open inside it.
function close(stack, name) {
  const at = stack.findLastIndex((e) => e.name === name);
  if (at >= 0) stack.length = at;
}

// Every start tag in order: { name, attrs, shown }.
export function elements(html) {
  const text = String(html ?? "");
  const lower = text.toLowerCase();
  const out = [];
  const stack = [];
  let hiding = 0;
  TAG.lastIndex = 0;
  for (let m = TAG.exec(text); m; m = TAG.exec(text)) {
    if (m[1]) {
      const name = m[1].toLowerCase();
      close(stack, name);
      hiding = stack.filter((e) => e.hides).length;
      continue;
    }
    if (!m[2]) continue;
    const name = m[2].toLowerCase();
    const attrs = attributes(m[3]);
    const hides = name === "template" || attrs.has("hidden");
    out.push({ name, attrs, shown: hiding === 0 && !hides });
    if (VOID.has(name) || /\/\s*$/.test(m[3])) continue;
    stack.push({ name, hides });
    if (hides) hiding++;
    if (RAW.has(name)) {
      const end = lower.indexOf(`</${name}`, TAG.lastIndex);
      TAG.lastIndex = end < 0 ? text.length : end;
    }
  }
  return out;
}

// A mark as written in params: "data-x" or "data-x=value".
export function parseMark(spec) {
  const s = String(spec);
  const eq = s.indexOf("=");
  return eq < 0 ? { attr: s.toLowerCase(), value: null } : { attr: s.slice(0, eq).toLowerCase(), value: s.slice(eq + 1) };
}

const carries = (el, { attr, value }) => el.attrs.has(attr) && (value === null || el.attrs.get(attr) === value);

// For each mark, how many elements carry it: all of them, or only those a
// visitor sees before a click (`visible`). `distinct` counts each value of
// the attribute once, so a company named twice counts once.
export function countMarks(html, marks, { visible = false, distinct = false } = {}) {
  const els = elements(html).filter((el) => !visible || el.shown);
  return marks.map((spec) => {
    const mark = parseMark(spec);
    const hits = els.filter((el) => carries(el, mark));
    return { mark: spec, count: distinct ? new Set(hits.map((el) => el.attrs.get(mark.attr))).size : hits.length };
  });
}

// The values each attribute in `attrs` takes on a page, as a Set per attribute.
export function markValues(html, attrs) {
  const els = elements(html);
  return new Map(attrs.map((a) => [a, new Set(els.filter((el) => el.attrs.has(a)).map((el) => el.attrs.get(a)))]));
}

// The <loc> URLs of a sitemap or a sitemap index.
export function sitemapLocs(xml) {
  return [...String(xml ?? "").matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => decode(m[1]));
}
