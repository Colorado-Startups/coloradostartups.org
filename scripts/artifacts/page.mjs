// One built page made into a self-contained review copy (inline-page.mjs):
// scripts bundled or dropped, styles and media inlined, embeds replaced, links
// rewritten.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

import { addReviewChrome, CHROME_CSS, rewriteLinks } from "./chrome.mjs";
import { dataUri, DIST, DROP_RULES, fail, hostOf, inlineCss, isInside, KNOWN_HOSTS, localFile, OUT, pickCandidate, routeOf, safeInline, scriptName } from "./shared.mjs";

async function loadDeps() {
  try {
    const [{ JSDOM, VirtualConsole }, esbuild] = await Promise.all([import("jsdom"), import("esbuild")]);
    return { JSDOM, VirtualConsole, esbuild };
  } catch (error) {
    fail(3, `could not load jsdom or esbuild (${error.message}); run npm ci at the repo root`);
  }
}


// Every file a bundled script pulls in must sit inside the build: an Astro
// chunk imports "./x.js" or "/_astro/x.js", nothing else. Two checks enforce
// it, so no file outside site/dist can be bundled into a published page:
//   onResolve refuses an import that escapes (a "../" climb, a "/../" root
//     path, a symlink out) or a bare package name, and maps "/x" root paths
//     into the build;
//   onLoad refuses to read any file outside the build, whatever resolved it.
// Entry points and relative imports keep esbuild's own resolution, which
// reads site/tsconfig.json (Astro's strict config), so the output keeps
// "use strict" as the site's own build does. Outside URLs stay
// external, and so does a missing file inside the build, which fails at
// runtime the way the site's own Pagefind import does in the viewer.
function containedResolver(distDir) {
  const escapes = (spec) => ({ errors: [{ text: `import "${spec}" resolves outside the build` }] });
  return {
    name: "contained",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (/^https?:\/\//.test(args.path)) return { path: args.path, external: true };
        if (args.kind === "entry-point") return isInside(args.path, distDir) ? undefined : escapes(args.path);
        if (path.isAbsolute(args.path) && isInside(args.path, distDir)) return undefined;
        if (args.path.startsWith("./") || args.path.startsWith("../")) {
          return isInside(path.resolve(args.resolveDir || distDir, args.path), distDir) ? undefined : escapes(args.path);
        }
        if (args.path.startsWith("/")) {
          const mapped = path.join(distDir, args.path);
          if (!isInside(mapped, distDir)) return escapes(args.path);
          return existsSync(mapped) ? { path: mapped } : { path: args.path, external: true };
        }
        return { errors: [{ text: `bare import "${args.path}" is not part of the build` }] };
      });
      build.onLoad({ filter: /.*/ }, (args) => (isInside(args.path, distDir) ? undefined : escapes(args.path)));
    },
  };
}

// Bundle one script (a dist file or inline module code) into a classic IIFE.
async function bundle(esbuild, { file, code }, distDir = DIST) {
  const result = await esbuild.build({
    ...(file
      ? { entryPoints: [file] }
      : { stdin: { contents: code, resolveDir: distDir, loader: "js", sourcefile: "inline.js" } }),
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "none",
    logLevel: "silent",
    plugins: [containedResolver(distDir)],
  });
  return result.outputFiles[0].text;
}

// The HTML spec's script types: no type or an empty one, or a JavaScript MIME
// type essence, is a classic script; "module" is a module; anything else is a
// data block the browser never runs. The type is trimmed and compared without
// case; a legacy language attribute stands in for a missing type.
const JS_MIME_TYPES = new Set([
  "application/ecmascript", "application/javascript", "application/x-ecmascript", "application/x-javascript",
  "text/ecmascript", "text/javascript", "text/javascript1.0", "text/javascript1.1", "text/javascript1.2",
  "text/javascript1.3", "text/javascript1.4", "text/javascript1.5", "text/jscript", "text/livescript",
  "text/x-ecmascript", "text/x-javascript",
]);
function scriptKind(type, language) {
  let t;
  if (type !== null && type !== undefined) t = type;
  else if (language) t = `text/${language}`;
  else t = "";
  t = t.trim().toLowerCase();
  if (t === "" || JS_MIME_TYPES.has(t)) return "classic";
  if (t === "module") return "module";
  return "data";
}

function dropReason(code) {
  return DROP_RULES.find((rule) => rule.pattern.test(code))?.reason ?? null;
}

function isStylesheet(el) {
  return /\bstylesheet\b/i.test(el.getAttribute("rel") || "");
}

// A local stylesheet's text, with its url() references inlined.
function stylesheetCss(file, notes) {
  return inlineCss(readFileSync(file, "utf8"), path.dirname(file), notes);
}

// A module or src script bundled, as { code, label }. Null when it is dropped
// (an outside host) or refused (a failed bundle), with the reason in notes.
async function bundleScript(el, src, page) {
  const file = src ? localFile(src, page.srcDir) : null;
  if (src && !file) {
    const host = hostOf(src);
    page.notes.dropped.push(`${KNOWN_HOSTS[host] ?? host} (outside host)`);
    return null;
  }
  const label = file ? scriptName(file) : "inline module script";
  try {
    return { code: await bundle(page.esbuild, file ? { file } : { code: el.textContent }), label };
  } catch (error) {
    page.notes.rejected.add(`${label} (${error.errors?.[0]?.text ?? error.message})`);
    return null;
  }
}

// Scripts: JSON-LD goes (search engines only); data islands stay; module
// and src scripts are bundled and moved to the end of the body, where a
// deferred module would have run; classic inline scripts stay in place.
// Returns "kept" when the element stays where it is.
async function handleScript(el, page) {
  const kind = scriptKind(el.getAttribute("type"), el.getAttribute("language"));
  if (kind === "data") {
    if ((el.getAttribute("type") || "").trim().toLowerCase() === "application/ld+json") return el.remove();
    return "kept";
  }
  const src = el.getAttribute("src");
  const moves = Boolean(src) || kind === "module";
  const script = moves ? await bundleScript(el, src, page) : { code: el.textContent, label: "inline script" };
  if (!script) return el.remove();
  const reason = dropReason(script.code);
  if (reason) {
    page.notes.dropped.push(`${script.label} (${reason})`);
    return el.remove();
  }
  if (!moves) return "kept";
  page.tailScripts.push(script.code);
  return el.remove();
}

// Head: keep the stylesheets in cascade order. Title, meta, preloads, icons,
// canonical and feed links stay behind: the Artifact skeleton supplies the
// charset and viewport, and the Artifact tool sets the title and icon.
// A classic inline script or a data block in the head stays in the head, in
// order; module and src scripts move to the end of the body.
async function headParts(page) {
  const parts = [];
  for (const el of [...page.doc.head.children]) {
    const tag = el.tagName.toLowerCase();
    if (tag === "link" && isStylesheet(el)) {
      const href = el.getAttribute("href") || "";
      const file = localFile(href, page.srcDir);
      if (file) parts.push(`<style>${safeInline(stylesheetCss(file, page.notes), "style")}</style>`);
      else if (/^https:\/\/fonts\.googleapis\.com\//.test(href)) parts.push(el.outerHTML);
      else page.notes.unresolved.add(href);
    } else if (tag === "style") {
      parts.push(`<style>${safeInline(inlineCss(el.textContent, page.srcDir, page.notes), "style")}</style>`);
    } else if (tag === "script" && (await handleScript(el, page)) === "kept") {
      parts.push(el.outerHTML);
    }
  }
  return parts;
}

// Body styles: each <style> and style attribute is inlined, and a local
// stylesheet <link> becomes a <style>. Every other <link> goes.
function inlineBodyStyles({ doc, body, srcDir, notes }) {
  for (const el of body.querySelectorAll("style")) el.textContent = inlineCss(el.textContent, srcDir, notes);
  for (const el of [...body.querySelectorAll("link")]) {
    const file = isStylesheet(el) ? localFile(el.getAttribute("href"), srcDir) : null;
    if (file) {
      const style = doc.createElement("style");
      style.textContent = stylesheetCss(file, notes);
      el.replaceWith(style);
    } else {
      el.remove();
    }
  }
  for (const el of body.querySelectorAll("[style]")) {
    el.setAttribute("style", inlineCss(el.getAttribute("style"), srcDir, notes));
  }
}

// Images: one inlined file per <img>; <source> candidates go.
function inlineMedia({ body, srcDir, notes }) {
  for (const el of [...body.querySelectorAll("picture source")]) el.remove();
  for (const el of body.querySelectorAll("img, video, audio, source, input[type=image]")) inlineMediaElement(el, srcDir, notes);
  for (const el of body.querySelectorAll("image, use")) {
    for (const attr of ["href", "xlink:href"]) {
      const ref = el.getAttribute(attr);
      if (!ref || ref.startsWith("#")) continue;
      const file = el.tagName.toLowerCase() === "image" ? localFile(ref, srcDir) : null;
      if (file) el.setAttribute(attr, dataUri(file));
      else notes.unresolved.add(ref);
    }
  }
}

// Inlines the src (the chosen srcset candidate when there is one) and the
// poster. The srcset, sizes and loading attributes go.
function inlineMediaElement(el, srcDir, notes) {
  const srcset = el.getAttribute("srcset");
  const chosen = srcset ? pickCandidate(srcset) : null;
  if (srcset) {
    el.removeAttribute("srcset");
    el.removeAttribute("sizes");
  }
  for (const attr of ["src", "poster"]) {
    const ref = attr === "src" && chosen ? chosen : el.getAttribute(attr);
    if (!ref) continue;
    const file = localFile(ref, srcDir);
    if (file) el.setAttribute(attr, dataUri(file));
    else if (!/^(data:|https?:)/.test(ref)) notes.unresolved.add(ref);
  }
  el.removeAttribute("loading");
}

// Embeds: the viewer refuses other sites in frames, so show what goes there.
function replaceEmbeds({ doc, body, notes }) {
  for (const el of [...body.querySelectorAll("iframe, object, embed")]) {
    const src = el.getAttribute("src") || el.getAttribute("data") || "";
    const label = el.getAttribute("title") || "embedded page";
    const box = doc.createElement("div");
    box.className = "l16-embed";
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", `${label} (embed is off in this review copy)`);
    const height = el.getAttribute("height");
    if (height && /^\d+$/.test(height)) box.style.minHeight = `${height}px`;
    const what = doc.createElement("p");
    const strong = doc.createElement("strong");
    strong.textContent = `Embed from ${hostOf(src)}`;
    what.append(strong);
    const why = doc.createElement("p");
    why.textContent = `Embeds are off in review copies. On the site this shows: ${label}.`;
    box.append(what, why);
    el.replaceWith(box);
    notes.embeds += 1;
  }
}


async function inlinePage(entry, ctx) {
  const srcFile = path.join(DIST, entry.file);
  const route = routeOf(entry.file);
  const dom = new ctx.JSDOM(readFileSync(srcFile, "utf8"), { virtualConsole: new ctx.VirtualConsole() });
  const doc = dom.window.document;
  const notes = { dropped: [], unresolved: new Set(), rejected: new Set(), embeds: 0 };
  // The page being inlined, which every step reads and changes.
  const page = { doc, body: doc.body, srcDir: path.dirname(srcFile), esbuild: ctx.esbuild, notes, tailScripts: [] };

  const head = await headParts(page);
  for (const el of [...page.body.querySelectorAll("script")]) await handleScript(el, page);
  inlineBodyStyles(page);
  inlineMedia(page);
  replaceEmbeds(page);
  rewriteLinks(page, route);
  const scripts = addReviewChrome(page, route, ctx);

  const html = [
    `<title>${entry.title}</title>`,
    `<!-- Generated by scripts/artifacts/inline-page.mjs from site/dist/${entry.file} (built from ${ctx.commit}). Do not edit; rerun the script. -->`,
    ...head,
    `<style>${CHROME_CSS.trim()}</style>`,
    page.body.innerHTML,
    scripts,
    "",
  ].join("\n");

  const outFile = path.join(OUT, `${entry.slug}.html`);
  writeFileSync(outFile, html);
  return { outFile, bytes: Buffer.byteLength(html), notes };
}

export { bundle, dropReason, inlinePage, loadDeps, scriptKind };
