// Client side of the Resourcus panel. Owner: L4.
//
// Security rules for this file, checked by test/unit/l4/panel-sinks.test.ts:
//   - Every string from the server or the visitor is rendered with
//     textContent. No HTML parsing sink appears anywhere in this folder.
//   - Card links come from our data, and only http and https URLs become
//     links. Pagefind results become links only for same-site paths.
//   - Turnstile runs once per browser session; the server remembers the
//     session (worker/resourcus/session.ts) and asks again with a 403.
//
// DOM calls use appendChild, not append: site/ loads the Workers runtime
// types, whose Element.append is HTMLRewriter's and rejects DOM nodes.

import type { AskResponse, ResourceCard } from "@cs/shared";

import { loadPagefind } from "../../lib/pagefind";

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const CANVAS_PATH = "/ecosystem-canvas/";
const SESSION_KEY = "resourcus.session";
const VERIFIED_KEY = "resourcus.verified";
const MAX_HISTORY = 6;

const TYPE_LABELS: Record<string, string> = {
  "service-provider": "Service provider",
  government: "Government program",
};

const FALLBACK_NOTES: Partial<Record<AskResponse["reason"], string>> = {
  budget: "Resourcus has used this month's budget, so these are keyword matches from Startup Resources.",
  error: "Resourcus could not reach its model just now, so these are keyword matches from Startup Resources.",
  "rate-limit": "You are asking quickly, so these are keyword matches from Startup Resources.",
  ok: "These are keyword matches from Startup Resources.",
};

// ---------- small helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export function sitePath(url: string): string | null {
  return url.startsWith("/") && !url.startsWith("//") && !url.includes("\\") ? url : null;
}

function storageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Private mode or storage blocked: the panel still works, it just
    // asks Turnstile more often.
  }
}

let memorySession: string | null = null;
function sessionId(): string {
  let id = storageGet(SESSION_KEY) ?? memorySession;
  if (!id) {
    id = crypto.randomUUID();
    storageSet(SESSION_KEY, id);
  }
  memorySession = id;
  return id;
}

function isAskResponse(v: unknown): v is AskResponse {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<AskResponse>;
  return (
    typeof r.answer === "string" &&
    Array.isArray(r.citations) &&
    Array.isArray(r.resources) &&
    (r.mode === "model" || r.mode === "fallback")
  );
}

// ---------- Turnstile ----------

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
}

let turnstileLoad: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  turnstileLoad ??= new Promise((resolve, reject) => {
    const existing = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
    if (existing) return resolve(existing);
    const script = document.createElement("script");
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.addEventListener("load", () => {
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (api) resolve(api);
      else reject(new Error("turnstile missing"));
    });
    script.addEventListener("error", () => reject(new Error("turnstile failed to load")));
    document.head.appendChild(script);
  });
  turnstileLoad.catch(() => (turnstileLoad = null));
  return turnstileLoad;
}

class TurnstileToken {
  private widgetId: string | null = null;
  private pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly siteKey: string,
  ) {}

  // An empty string when this build has no site key: the question goes out
  // without a token and the server answers 403, which the panel explains.
  async get(): Promise<string> {
    if (!this.siteKey) return "";
    const api = await loadTurnstile();
    return new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject };
      if (this.widgetId === null) {
        this.widgetId = api.render(this.container, {
          sitekey: this.siteKey,
          appearance: "interaction-only",
          execution: "execute",
          callback: (token: string) => this.settle(token),
          "error-callback": () => this.settle(new Error("turnstile error")),
          "expired-callback": () => this.settle(new Error("turnstile expired")),
        });
      } else {
        api.reset(this.widgetId);
      }
      api.execute(this.widgetId);
    });
  }

  private settle(result: string | Error): void {
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    if (typeof result === "string") p.resolve(result);
    else p.reject(result);
  }
}

// ---------- Pagefind ----------

interface PagefindHit {
  title: string;
  path: string;
}

/** Throws when Pagefind is not there, so the caller offers the Canvas instead. */
async function pagefindSearch(query: string): Promise<PagefindHit[]> {
  const found = await (await loadPagefind())?.search(query);
  if (!found) throw new Error("Pagefind is not available");
  const data = await Promise.all(found.results.slice(0, 5).map((r) => r.data()));
  return data
    .map((d) => ({ title: String(d.meta?.title ?? d.url), path: sitePath(String(d.url)) }))
    .filter((h): h is PagefindHit => h.path !== null && !/^\/404(\.html|\/)?$/.test(h.path));
}

// ---------- the panel ----------

type Turn = { role: "user" | "assistant"; content: string };

class Panel {
  private readonly form: HTMLFormElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly submit: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly thread: HTMLElement;
  private readonly compact: boolean;
  private readonly turnstile: TurnstileToken;
  private history: Turn[] = [];
  private busy = false;

  constructor(private readonly root: HTMLElement) {
    this.form = root.querySelector<HTMLFormElement>("[data-form]")!;
    this.textarea = this.form.querySelector<HTMLTextAreaElement>("textarea")!;
    this.submit = root.querySelector<HTMLButtonElement>("[data-submit]")!;
    this.status = root.querySelector<HTMLElement>("[data-status]")!;
    this.thread = root.querySelector<HTMLElement>("[data-thread]")!;
    this.compact = root.dataset.compact === "true";
    this.turnstile = new TurnstileToken(root.querySelector<HTMLElement>("[data-turnstile]")!, root.dataset.sitekey ?? "");
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.ask();
    });
  }

  private setStatus(text: string, tone: "info" | "error" = "info"): void {
    this.status.textContent = text;
    this.status.dataset.tone = tone;
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.root.setAttribute("aria-busy", String(busy));
    this.submit.disabled = busy;
  }

  private async post(question: string, withToken: boolean): Promise<Response> {
    const body: Record<string, unknown> = {
      question,
      history: this.history.slice(-MAX_HISTORY),
      sessionId: sessionId(),
    };
    if (withToken) {
      const token = await this.turnstile.get();
      if (token) body.turnstileToken = token;
    }
    return fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async ask(): Promise<void> {
    if (this.busy) return;
    const question = this.textarea.value.trim();
    if (question.length < 2) {
      this.setStatus("Type a question first.", "error");
      this.textarea.focus();
      return;
    }
    this.setBusy(true);
    this.setStatus("Resourcus is searching Startup Resources.");
    try {
      let res = await this.post(question, storageGet(VERIFIED_KEY) !== "yes");
      if (res.status === 403) {
        storageSet(VERIFIED_KEY, null);
        res = await this.post(question, true);
      }
      await this.handle(question, res);
    } catch {
      this.setStatus("Resourcus could not answer just now.", "error");
      this.renderSearchOffer(this.thread, question);
    } finally {
      this.setBusy(false);
    }
  }

  private async handle(question: string, res: Response): Promise<void> {
    if (res.status === 429) {
      this.setStatus("You are asking quickly. Wait a minute, then ask again.", "error");
      return;
    }
    if (res.status === 400) {
      this.setStatus("Resourcus could not read that question. Try a shorter one.", "error");
      return;
    }
    if (res.status === 403) {
      this.setStatus("Resourcus could not confirm you are a person. Reload the page, then ask again.", "error");
      return;
    }
    const body: unknown = res.ok ? await res.json().catch(() => null) : null;
    if (!isAskResponse(body)) {
      this.setStatus("Resourcus could not answer just now.", "error");
      this.renderSearchOffer(this.thread, question);
      return;
    }
    storageSet(VERIFIED_KEY, "yes");
    this.setStatus("");
    this.textarea.value = "";
    this.history.push({ role: "user", content: question }, { role: "assistant", content: body.answer });
    this.history = this.history.slice(-MAX_HISTORY);
    this.renderAnswer(question, body);
  }

  private renderAnswer(question: string, res: AskResponse): void {
    const block = el("article", "resourcus__turn stack");
    block.appendChild(el("p", "resourcus__asked", `You asked: ${question}`));
    block.appendChild(el("p", "resourcus__answer", res.answer));

    const limit = this.compact ? 3 : 5;
    const cards = res.resources.slice(0, limit);
    if (cards.length > 0) {
      const list = el("ul", "resourcus__cards");
      for (const card of cards) list.appendChild(this.renderCard(card));
      block.appendChild(list);
    }
    const note = res.mode === "fallback" ? FALLBACK_NOTES[res.reason] : undefined;
    if (note && cards.length > 0) block.appendChild(el("p", "resourcus__note", note));
    if (res.mode === "fallback" || cards.length === 0) this.renderSearchOffer(block, question);

    this.thread.appendChild(block);
    block.scrollIntoView({ block: "nearest" });
  }

  private renderCard(card: ResourceCard): HTMLLIElement {
    const item = el("li", "resourcus__card");
    const title = el("h4");
    const href = safeHref(card.url);
    if (href) {
      const link = el("a", undefined, card.name);
      link.href = href;
      link.rel = "noopener noreferrer";
      title.appendChild(link);
    } else {
      title.textContent = card.name;
    }
    item.appendChild(title);
    const type = TYPE_LABELS[card.type] ?? card.type.charAt(0).toUpperCase() + card.type.slice(1);
    item.appendChild(el("p", "meta", `${type}, ${card.city}`));
    item.appendChild(el("p", undefined, card.description));
    return item;
  }

  private renderSearchOffer(parent: HTMLElement, question: string): void {
    const wrap = el("div", "resourcus__search");
    const button = el("button", "btn btn--stone", "Search the site for these words");
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      const results = el("div");
      try {
        const hits = await pagefindSearch(question);
        if (hits.length === 0) {
          results.appendChild(el("p", "resourcus__note", "Keyword search found nothing for those words."));
        } else {
          const list = el("ul", "resourcus__links");
          for (const hit of hits) {
            const li = el("li");
            const a = el("a", undefined, hit.title);
            a.href = hit.path;
            li.appendChild(a);
            list.appendChild(li);
          }
          results.appendChild(list);
        }
      } catch {
        const p = el("p", "resourcus__note", "Keyword search is not available here. ");
        const a = el("a", undefined, "Browse Startup Resources");
        a.href = CANVAS_PATH;
        p.appendChild(a);
        results.appendChild(p);
      }
      button.replaceWith(results);
    });
    wrap.appendChild(button);
    parent.appendChild(wrap);
  }
}

export function initResourcusPanels(): void {
  for (const root of document.querySelectorAll<HTMLElement>("[data-resourcus]")) {
    if (root.dataset.ready === "true") continue;
    root.dataset.ready = "true";
    new Panel(root);
  }
}
