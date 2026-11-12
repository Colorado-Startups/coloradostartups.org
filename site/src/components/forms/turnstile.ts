// Turnstile for the site's HTML forms, loaded only when a visitor starts on a
// form (#121). Bundled as an external file, because the CSP allows no inline
// scripts.
//
// 1. Nothing loads with the page. The first focus, pointer press or input
//    inside a form loads Cloudflare's script in explicit mode and renders that
//    form's box, so the challenge runs while the visitor types.
// 2. The box is interaction-only (#203): it takes no room unless Cloudflare
//    needs the visitor to act.
// 3. Turnstile writes its token into a hidden cf-turnstile-response field in
//    the box, and the form posts it as before. A submit that comes before the
//    token waits for it, then sends. While it waits, a polite live region
//    tells screen readers why nothing happened yet (#447).
// 4. When the script fails to load, when a held submit has waited
//    LOAD_TIMEOUT_MS for it, when render throws or returns no widget id, or
//    when the challenge errors, the form sends without a token. The Worker
//    answers ?error=verification, which every form already explains. A script
//    that arrives after the wait still renders, so the next submit carries a
//    token (#514).

export const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TOKEN_FIELD = "cf-turnstile-response";
const STARTERS = ["focusin", "pointerdown", "input"] as const;

// How long a held submit waits for Cloudflare's script before it sends
// without a token. A blocked or stalled request can end with no error event,
// and a submit held on it would wait forever (#447). The clock runs only
// while a submit is held: a slow script with no submit waiting is not a
// failure (#514). A goal, not a
// measurement: long enough for a slow connection, short enough that the
// visitor still gets the server's explanation (?error=verification) instead
// of a dead button.
export const LOAD_TIMEOUT_MS = 15_000;

// Read out while a submit is held for the token. Plain words, no metaphor
// (01_doctrine/voice.md: forms stay literal).
export const HELD_MESSAGE = "Checking you are a person. One moment.";

export interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string | undefined;
}

type TurnstileWindow = Window & { turnstile?: TurnstileApi };

let loading: Promise<TurnstileApi> | null = null;

// One script per page. The Resourcus panel loads the same URL
// (components/resourcus/panel.ts), and each loader reuses window.turnstile
// when the other got there first.
export function loadTurnstile(win: TurnstileWindow = window): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (win.turnstile) return resolve(win.turnstile);
    const script = win.document.createElement("script");
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.addEventListener("load", () => (win.turnstile ? resolve(win.turnstile) : reject(new Error("turnstile missing"))));
    script.addEventListener("error", () => reject(new Error("turnstile failed to load")));
    win.document.head.appendChild(script);
  });
  return loading;
}

class FormTurnstile {
  private state: "idle" | "loading" | "ready" | "failed" = "idle";
  // True after an error or timeout until the next token, so a submit in that
  // window sends at once instead of waiting on a challenge that may not rerun.
  private errored = false;
  private resubmit: (() => void) | null = null;
  // Runs only while a submit is held and the script has not arrived.
  private waitTimer: ReturnType<typeof setTimeout> | undefined;
  // A polite live region beside the box. It exists before it speaks, because
  // screen readers announce changes to a region they already know.
  private readonly status: HTMLElement;

  constructor(
    private readonly form: HTMLFormElement,
    private readonly box: HTMLElement,
    private readonly load: () => Promise<TurnstileApi>,
  ) {
    this.status = box.ownerDocument.createElement("p");
    this.status.className = "visually-hidden";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    box.insertAdjacentElement("afterend", this.status);
    for (const type of STARTERS) form.addEventListener(type, this.start);
    form.addEventListener("submit", this.onSubmit);
  }

  private readonly start = (): void => {
    if (this.state !== "idle") return;
    this.state = "loading";
    for (const type of STARTERS) this.form.removeEventListener(type, this.start);
    this.load().then(
      (api) => {
        if (this.state !== "loading") return;
        // A held submit now waits on the challenge, which has its own
        // error and timeout callbacks.
        this.stopWaiting();
        try {
          const { sitekey, action, size } = this.box.dataset;
          const widget = api.render(this.box, {
            sitekey,
            ...(action ? { action } : {}),
            size: size ?? "normal",
            appearance: "interaction-only",
            callback: (token: string) => {
              this.fillToken(token);
              this.settle(false);
            },
            "error-callback": () => this.settle(true),
            "timeout-callback": () => this.settle(true),
          });
          // TurnstileApi allows undefined, which means no widget was made. No
          // callback will ever fire for it, so treat anything but a widget id
          // as a throw.
          if (typeof widget !== "string" || widget === "") throw new Error("turnstile did not render");
          this.state = "ready";
        } catch {
          this.fail();
        }
      },
      () => {
        if (this.state === "loading") this.fail();
      },
    );
  };

  // No challenge will run: the script is missing, slow or broken. Release a
  // held submit and let later ones through without a token.
  private fail(): void {
    this.stopWaiting();
    this.state = "failed";
    this.settle(true);
  }

  // A held submit waited LOAD_TIMEOUT_MS for the script: send it without a
  // token. The state stays loading, so a late script still renders and a
  // token clears the error for the next submit (#514).
  private giveUp(): void {
    this.waitTimer = undefined;
    this.settle(true);
  }

  private stopWaiting(): void {
    clearTimeout(this.waitTimer);
    this.waitTimer = undefined;
  }

  private settle(errored: boolean): void {
    this.errored = errored;
    this.status.textContent = "";
    const send = this.resubmit;
    this.resubmit = null;
    send?.();
  }

  private tokenField(): HTMLInputElement | null {
    return this.box.querySelector<HTMLInputElement>(`input[name="${TOKEN_FIELD}"]`);
  }

  private hasToken(): boolean {
    return Boolean(this.tokenField()?.value);
  }

  // Cloudflare fills its own hidden field. If the callback ever comes first,
  // the token goes in here, so the resent submit carries it and cannot wait
  // on itself.
  private fillToken(token: string): void {
    let field = this.tokenField();
    if (!field) {
      field = this.box.ownerDocument.createElement("input");
      field.type = "hidden";
      field.name = TOKEN_FIELD;
      this.box.appendChild(field);
    }
    if (!field.value) field.value = token;
  }

  private readonly onSubmit = (event: SubmitEvent): void => {
    if (event.defaultPrevented || this.hasToken()) return;
    if (this.state === "failed" || this.errored) return;
    event.preventDefault();
    const submitter = event.submitter instanceof HTMLButtonElement ? event.submitter : null;
    this.resubmit = () => this.form.requestSubmit(submitter);
    // Set it once; a second press while held must not read it out again.
    if (this.status.textContent !== HELD_MESSAGE) this.status.textContent = HELD_MESSAGE;
    this.start();
    if (this.state === "loading" && this.waitTimer === undefined) {
      this.waitTimer = setTimeout(() => this.giveUp(), LOAD_TIMEOUT_MS);
    }
  };
}

// Wires every lazy box on the page. A box without a site key (a build with no
// PUBLIC_TURNSTILE_SITE_KEY) loads nothing; its form posts without a token.
export function initLazyTurnstile(doc: Document, load: () => Promise<TurnstileApi> = () => loadTurnstile()): void {
  for (const box of doc.querySelectorAll<HTMLElement>(".cf-turnstile[data-turnstile-lazy]")) {
    const form = box.closest("form");
    if (form && box.dataset.sitekey) new FormTurnstile(form, box, load);
  }
}
