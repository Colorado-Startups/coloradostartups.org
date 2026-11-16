// The View side of MCP Apps, hand-written: JSON-RPC 2.0 over postMessage with
// the host. The official client (@modelcontextprotocol/ext-apps 2.1.0) bundles
// to 546 KB with its dependencies (dist/src/app-with-deps.js), far over the
// 40 KB cap for one card, so this shim implements only what the cards use.
// No imports, so test/unit/mcp/ui.test.ts drives it with a fake window, and
// site/scripts/build-mcp-ui.mjs inlines it (it drops the `export` keywords).
//
// Spec: MCP Apps, SEP-1865, specification/2026-01-26/apps.mdx in
// github.com/modelcontextprotocol/ext-apps at tag v2.1.0. Sections quoted:
//
// "Transport Layer": "MCP Apps uses JSON-RPC 2.0 over `postMessage` for
//   iframe-host communication." Only messages whose source is window.parent
//   are read, as the SDK's PostMessageTransport does.
// "App Capabilities in `ui/initialize`": "When the View sends an
//   `ui/initialize` request to the Host, it MUST include its capabilities in
//   the `appCapabilities` field." Params: appInfo, appCapabilities, protocolVersion.
// "Lifecycle", step 2: "UI ->> H: ui/initialize", then
//   "UI ->> H: ui/notifications/initialized".
// "Notifications (Host -> View)": "`ui/notifications/tool-input` - Host MUST
//   send this notification with the complete tool arguments", params { arguments };
//   the region card's fallback reads the region id from it.
//   "`ui/notifications/tool-result` - Tool
//   execution result", params: CallToolResult. "`ui/notifications/host-context-changed`
//   ... the View SHOULD merge received fields with its current context state."
// "`ui/resource-teardown` - Host notifies View before teardown" is a request:
//   "Host SHOULD wait for a response", answered here with an empty result.
// "Standard MCP Messages": "`ping` - Connection health check", answered empty.
// "Requests (View -> Host)": "`ui/open-link` - Request host to open external
//   URL", params { url }.
// "`ui/notifications/size-changed` - View's size changed", params { width,
//   height }: "The View SHOULD send this notification when rendered content
//   body size changes (e.g. using ResizeObserver API ...)".
// "Theming": the host context's `theme` is "light" or "dark". The cards keep
//   the brand's own colors and set data-theme from it.

export const PROTOCOL_VERSION = "2026-01-26";
export const APP_INFO = { name: "coloradostartups-cards", version: "1.0.0" };

/**
 * A bridge to the host. `handlers.toolResult(result)` gets each tool result;
 * `handlers.context(partialContext)` gets the host context from the
 * initialize result and from each host-context-changed notification.
 */
export function createBridge(win, handlers) {
  const parent = win.parent;
  const pending = new Map();
  let nextId = 1;
  let hostCapabilities = {};

  const post = (message) => parent.postMessage(message, "*");
  const notify = (method, params) => post({ jsonrpc: "2.0", method, params });
  function request(method, params) {
    const id = nextId++;
    post({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  function onMessage(event) {
    if (event.source !== parent) return;
    const m = event.data;
    if (!m || typeof m !== "object" || m.jsonrpc !== "2.0") return;
    if (typeof m.method !== "string") {
      // A response to one of this View's requests.
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.reject(new Error(String(m.error.message ?? "Request failed")));
      else p.resolve(m.result ?? {});
      return;
    }
    if (m.id !== undefined && m.id !== null) {
      // A request from the host: answer the two the cards support, refuse the rest.
      if (m.method === "ui/resource-teardown" || m.method === "ping") post({ jsonrpc: "2.0", id: m.id, result: {} });
      else post({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } });
      return;
    }
    if (m.method === "ui/notifications/tool-input") handlers.toolInput?.(m.params ?? {});
    else if (m.method === "ui/notifications/tool-result") handlers.toolResult(m.params ?? {});
    else if (m.method === "ui/notifications/host-context-changed") handlers.context(m.params ?? {});
  }
  win.addEventListener("message", onMessage);

  return {
    /** The ui/initialize handshake, then the initialized notification. */
    async connect() {
      const result = await request("ui/initialize", {
        appInfo: APP_INFO,
        appCapabilities: { availableDisplayModes: ["inline"] },
        protocolVersion: PROTOCOL_VERSION,
      });
      hostCapabilities = result.hostCapabilities ?? {};
      handlers.context(result.hostContext ?? {});
      notify("ui/notifications/initialized", {});
      return result;
    },
    /** Opens an https URL through the host; false when the host cannot or will not. */
    async openLink(url) {
      if (!/^https:\/\//.test(url) || !hostCapabilities.openLinks) return false;
      try {
        await request("ui/open-link", { url });
        return true;
      } catch {
        return false;
      }
    },
    reportSize(width, height) {
      notify("ui/notifications/size-changed", { width, height });
    },
  };
}

/** The host's light or dark theme on <html data-theme>, and its safe-area insets as padding. */
export function applyContext(doc, ctx) {
  if (ctx.theme === "light" || ctx.theme === "dark") doc.documentElement.setAttribute("data-theme", ctx.theme);
  const s = ctx.safeAreaInsets;
  if (s && [s.top, s.right, s.bottom, s.left].every((n) => typeof n === "number")) {
    doc.body.style.padding = `${s.top}px ${s.right}px ${s.bottom}px ${s.left}px`;
  }
}

/** How long the card waits for the handshake, and then again for the first tool result. */
export const WAIT_MS = 3000;

/**
 * Wires a card: renders each tool result into #app, opens links through the
 * host, reports size. `render(result, input)` gives the card's HTML;
 * `fallback(input)` gives the one-line card for when the host never answers,
 * never sends a result, or sends one `render` cannot read. A result that
 * arrives after the fallback still renders.
 */
export function startCard(win, doc, render, fallback) {
  const app = doc.getElementById("app");
  let input = null;
  let rendered = false;
  let timer = null;
  const later = (fn) => {
    if (timer !== null) win.clearTimeout(timer);
    timer = win.setTimeout(fn, WAIT_MS);
  };
  const showFallback = () => {
    if (!rendered) app.innerHTML = fallback(input);
  };
  const bridge = createBridge(win, {
    toolInput: (params) => {
      input = params && typeof params.arguments === "object" ? params.arguments : null;
    },
    toolResult: (result) => {
      rendered = true;
      if (timer !== null) win.clearTimeout(timer);
      try {
        app.innerHTML = render(result, input);
      } catch {
        app.innerHTML = fallback(input);
      }
      measure();
    },
    context: (ctx) => applyContext(doc, ctx),
  });
  app.addEventListener("click", (event) => {
    const a = event.target && event.target.closest ? event.target.closest("a[data-link]") : null;
    if (!a) return;
    event.preventDefault();
    const url = a.getAttribute("data-link");
    bridge.openLink(url).then((opened) => {
      if (!opened) win.open(url, "_blank", "noopener");
    });
  });
  // The size the SDK reports: the content's own height, the window's width.
  let last = "";
  function measure() {
    const el = doc.documentElement;
    const before = el.style.height;
    el.style.height = "max-content";
    const height = Math.ceil(el.getBoundingClientRect().height);
    el.style.height = before;
    const width = Math.ceil(win.innerWidth);
    const key = `${width}x${height}`;
    if (key !== last) {
      last = key;
      bridge.reportSize(width, height);
    }
  }
  if (typeof win.ResizeObserver === "function") new win.ResizeObserver(measure).observe(doc.documentElement);
  // No answer to ui/initialize in time: the fallback. After the handshake, the same wait for a result.
  later(() => {
    showFallback();
    measure();
  });
  bridge.connect().then(
    () => {
      if (!rendered) {
        later(() => {
          showFallback();
          measure();
        });
      }
      measure();
    },
    () => {
      showFallback();
      measure();
    },
  );
  return bridge;
}
