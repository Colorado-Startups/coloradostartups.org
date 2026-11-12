// The review copy's chrome (page.mjs): the bar on top, the toast, and the
// script that stops links and forms in the Artifact viewer.


import { normalizeRoute, safeInline } from "./shared.mjs";

const CHROME_CSS = `
.l16-review{display:flex;flex-wrap:wrap;gap:4px 16px;align-items:baseline;padding-block:6px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));background:#1f1f1f;color:#ededed;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.l16-review strong{color:#ffd66e;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
@media (width<=600px){.l16-review{font-size:11px;gap:2px 12px}}
.l16-toast{position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom,0px));width:min(560px,calc(100% - 32px));padding:12px 16px;border-radius:6px;background:#1f1f1f;color:#ededed;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;box-shadow:0 6px 24px rgb(0 0 0/.35)}
.l16-toast a{color:#ffd66e}
.l16-embed{display:grid;place-content:center;gap:8px;width:100%;min-height:clamp(320px,60vh,720px);padding:24px;text-align:center;color:var(--c-text-dim,#5a4632);background:repeating-linear-gradient(135deg,var(--c-surface,#fdf1d8) 0 14px,var(--c-surface-2,#f8e3b8) 14px 28px)}
.l16-embed p{margin:0;max-width:44ch}
.l16-embed strong{color:var(--c-text,#2b1d12)}
`;

// Runs in the Artifact. Links between pages and form posts would leave the
// review copy, so it stops them and says where they go on the real site.
// It listens on window in the bubble phase, after page scripts: a click or
// submit a kept script already handled (defaultPrevented) is left alone.
const CHROME_JS = `(() => {
  const routes = __ROUTES__;
  const toast = document.getElementById("l16-toast");
  let timer;
  const text = (s) => document.createTextNode(s);
  const show = (parts) => {
    toast.replaceChildren(...parts);
    toast.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => { toast.hidden = true; }, 8000);
  };
  ${normalizeRoute}
  window.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const a = event.target instanceof Element ? event.target.closest("a[href]") : null;
    const href = a ? a.getAttribute("href") : "";
    if (!href.startsWith("/") || href.startsWith("//")) return;
    event.preventDefault();
    const page = routes[normalizeRoute(href)];
    const parts = [text("Links between pages are off in review copies. On the site, this opens " + href + ".")];
    if (page && page.url) {
      const link = document.createElement("a");
      link.href = page.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = page.title;
      parts.push(text(" Its review copy: "), link, text("."));
    }
    show(parts);
  });
  window.addEventListener("submit", (event) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    const action = event.target.getAttribute("action");
    show([text("Forms are off in review copies, so nothing was sent." + (action ? " On the site, this form posts to " + action + "." : ""))]);
  });
})();`;


// Links: same-page links become plain anchors, which the viewer allows.
// Outside links open a new tab instead of replacing the review copy.
function rewriteLinks({ body }, route) {
  for (const a of body.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (/^https?:\/\//i.test(href)) {
      a.setAttribute("target", "_blank");
      const rel = new Set((a.getAttribute("rel") || "").split(/\s+/).filter(Boolean));
      rel.add("noopener");
      a.setAttribute("rel", [...rel].join(" "));
    } else if (href.startsWith("/") && !href.startsWith("//") && normalizeRoute(href) === route) {
      const hash = href.includes("#") ? href.slice(href.indexOf("#")) : "#";
      a.setAttribute("href", hash);
    }
  }
}

// Review chrome: the bar on top and the toast. Returns the scripts for the
// end of the body: the moved page scripts, then CHROME_JS.
function addReviewChrome({ doc, body, notes, tailScripts }, route, ctx) {
  const bar = doc.createElement("div");
  bar.className = "l16-review";
  bar.setAttribute("role", "note");
  bar.setAttribute("aria-label", "About this review copy");
  const facts = [
    route,
    `built from ${ctx.commit}`,
    ctx.art === 0 ? "art: placeholders (L7)" : `art: ${ctx.art} files (L7)`,
    "links, forms, embeds off",
  ];
  if (notes.dropped.length) facts.push(`dropped: ${notes.dropped.join(", ")}`);
  const label = doc.createElement("strong");
  label.textContent = "Review copy";
  bar.append(label, ...facts.map((fact) => Object.assign(doc.createElement("span"), { textContent: fact })));
  body.prepend(bar);

  const toast = doc.createElement("div");
  toast.id = "l16-toast";
  toast.className = "l16-toast";
  toast.setAttribute("role", "status");
  toast.hidden = true;
  body.append(toast);

  const routes = JSON.stringify(ctx.routes).replace(/</g, "\\u003c");
  return [...tailScripts, CHROME_JS.replace("__ROUTES__", routes)]
    .map((code) => `<script>${safeInline(code, "script")}</script>`)
    .join("\n");
}

export { addReviewChrome, CHROME_CSS, rewriteLinks };
