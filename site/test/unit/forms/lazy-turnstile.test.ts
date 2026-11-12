// @vitest-environment jsdom
// #121 and #203: the forms load Turnstile only when a visitor starts on one,
// and a submit that beats the token waits for it. A fake API stands in for
// Cloudflare's script, so no test reaches challenges.cloudflare.com.
// #447: a render error or a script that never loads releases the held submit,
// and a held submit tells screen readers why it waits.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HELD_MESSAGE,
  initLazyTurnstile,
  LOAD_TIMEOUT_MS,
  type TurnstileApi,
} from "../../../src/components/forms/turnstile";

type Options = Record<string, unknown> & { callback: (token: string) => void; "error-callback": () => void };

function page(box = '<div class="cf-turnstile" data-turnstile-lazy data-sitekey="site-key" data-size="flexible"></div>') {
  document.body.innerHTML = `<form><input name="email" />${box}<button type="submit">Send</button></form>`;
  const form = document.querySelector("form")!;
  return {
    form,
    box: form.querySelector<HTMLElement>(".cf-turnstile")!,
    button: form.querySelector("button")!,
    email: form.querySelector("input")!,
  };
}

// A stand-in for window.turnstile. Rendering writes the hidden field the way
// Cloudflare's widget does; token() fills it and calls the callback.
function fakeApi() {
  const renders: { box: HTMLElement; options: Options }[] = [];
  const api: TurnstileApi = {
    render(box, options) {
      const field = document.createElement("input");
      field.type = "hidden";
      field.name = "cf-turnstile-response";
      box.appendChild(field);
      renders.push({ box, options: options as Options });
      return "widget-1";
    },
  };
  const token = (value = "token-1") => {
    const { box, options } = renders[0]!;
    box.querySelector<HTMLInputElement>("input[name='cf-turnstile-response']")!.value = value;
    options.callback(value);
  };
  return { api, renders, token };
}

function submit(form: HTMLFormElement, submitter: HTMLElement): SubmitEvent {
  const event = new SubmitEvent("submit", { cancelable: true, bubbles: true, submitter });
  form.dispatchEvent(event);
  return event;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("lazy Turnstile on a form", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("loads nothing until the visitor starts on the form, then renders once", async () => {
    const { form, box, email } = page();
    const { api, renders } = fakeApi();
    const load = vi.fn(async () => api);
    initLazyTurnstile(document, load);
    expect(load).not.toHaveBeenCalled();

    email.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    email.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await flush();

    expect(load).toHaveBeenCalledTimes(1);
    expect(renders).toHaveLength(1);
    expect(renders[0]!.box).toBe(box);
    expect(renders[0]!.options).toMatchObject({ sitekey: "site-key", size: "flexible", appearance: "interaction-only" });
    expect(renders[0]!.options).not.toHaveProperty("action");
  });

  it("passes the form's action when the box names one", async () => {
    const { email } = page('<div class="cf-turnstile" data-turnstile-lazy data-sitekey="k" data-action="suggest-resource"></div>');
    const { api, renders } = fakeApi();
    initLazyTurnstile(document, async () => api);
    email.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flush();
    expect(renders[0]!.options).toMatchObject({ action: "suggest-resource", size: "normal" });
  });

  it("loads nothing for a box with no site key", async () => {
    const { form, email, button } = page('<div class="cf-turnstile" data-turnstile-lazy data-sitekey=""></div>');
    const load = vi.fn(async () => fakeApi().api);
    initLazyTurnstile(document, load);
    email.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(submit(form, button).defaultPrevented).toBe(false);
  });

  it("holds a submit that comes before the token, then sends it with the same button", async () => {
    const { form, email, button } = page();
    const { api, token } = fakeApi();
    initLazyTurnstile(document, async () => api);
    const send = vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

    email.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flush();
    expect(submit(form, button).defaultPrevented).toBe(true);
    expect(send).not.toHaveBeenCalled();

    token();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(button);
    // The resent submit carries the token, so it goes through.
    expect(submit(form, button).defaultPrevented).toBe(false);
  });

  it("writes the token itself when the callback comes before Cloudflare's field", async () => {
    const { form, box, button } = page();
    let options: Options | undefined;
    const api: TurnstileApi = {
      render(_box, o) {
        options = o as Options;
        return "widget-1";
      },
    };
    initLazyTurnstile(document, async () => api);
    const send = vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

    expect(submit(form, button).defaultPrevented).toBe(true);
    await flush();
    options!.callback("token-early");
    expect(box.querySelector<HTMLInputElement>("input[name='cf-turnstile-response']")?.value).toBe("token-early");
    expect(send).toHaveBeenCalledTimes(1);
    expect(submit(form, button).defaultPrevented).toBe(false);
  });

  it("starts Turnstile from a submit that no focus came before", async () => {
    const { form, button } = page();
    const { api, renders, token } = fakeApi();
    initLazyTurnstile(document, async () => api);
    const send = vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

    expect(submit(form, button).defaultPrevented).toBe(true);
    await flush();
    expect(renders).toHaveLength(1);
    token();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends without a token when Cloudflare's script fails to load", async () => {
    const { form, email, button } = page();
    initLazyTurnstile(document, () => Promise.reject(new Error("blocked")));
    const send = vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

    expect(submit(form, button).defaultPrevented).toBe(true);
    await flush();
    // The held submit is released, and later ones go straight through.
    expect(send).toHaveBeenCalledTimes(1);
    email.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(submit(form, button).defaultPrevented).toBe(false);
  });

  it("releases a held submit when the challenge errors, and waits again after a new token", async () => {
    const { form, email, button } = page();
    const { api, renders, token } = fakeApi();
    initLazyTurnstile(document, async () => api);
    const send = vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

    email.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flush();
    expect(submit(form, button).defaultPrevented).toBe(true);
    renders[0]!.options["error-callback"]();
    expect(send).toHaveBeenCalledTimes(1);
    // While the error stands, a submit goes out and the Worker explains it.
    expect(submit(form, button).defaultPrevented).toBe(false);

    // Turnstile retries on its own; once a token arrives, it posts with it.
    token("token-2");
    expect(submit(form, button).defaultPrevented).toBe(false);
  });

  it("leaves a submit another handler already stopped alone", async () => {
    const { form, button } = page();
    const load = vi.fn(async () => fakeApi().api);
    initLazyTurnstile(document, load);
    form.addEventListener("submit", (e) => e.preventDefault(), { capture: true });
    submit(form, button);
    await flush();
    expect(load).not.toHaveBeenCalled();
  });
});

describe("a form Turnstile cannot serve (#447)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const statusOf = (box: HTMLElement) => box.nextElementSibling as HTMLElement;

  it("sends without a token when render throws, and does not hold later submits", async () => {
    const { form, box, email, button } = page();
    const render = vi.fn(() => {
      throw new Error("bad sitekey");
    });
    initLazyTurnstile(document, async () => ({ render }));
    const send = vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

    expect(submit(form, button).defaultPrevented).toBe(true);
    await flush();
    expect(render).toHaveBeenCalledTimes(1);
    // The held submit is released once, and the message is gone.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(button);
    expect(statusOf(box).textContent).toBe("");
    // The state is failed, not loading: the next submit posts at once.
    email.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(submit(form, button).defaultPrevented).toBe(false);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("sends without a token when render throws before any submit", async () => {
    const { form, email, button } = page();
    initLazyTurnstile(document, async () => ({
      render() {
        throw new Error("bad sitekey");
      },
    }));

    email.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flush();
    expect(submit(form, button).defaultPrevented).toBe(false);
  });

  // Cloudflare's render can return no widget id instead of throwing. No
  // callback follows, so the form must not wait on one.
  it.each([
    ["undefined", undefined],
    ["an empty string", ""],
    ["a value that is not a string", { id: 1 }],
  ])("sends without a token when render returns %s instead of a widget id", async (_label, returned) => {
    const { form, box, email, button } = page();
    const render = vi.fn(() => returned as unknown as string);
    initLazyTurnstile(document, async () => ({ render }));
    const send = vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

    expect(submit(form, button).defaultPrevented).toBe(true);
    expect(statusOf(box).textContent).toBe(HELD_MESSAGE);
    await flush();
    expect(render).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(button);
    expect(statusOf(box).textContent).toBe("");
    // The state is failed: later submits post at once, and render does not rerun.
    email.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(submit(form, button).defaultPrevented).toBe(false);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("keeps a token that arrived during render even if render then returns no widget id", async () => {
    const { form, box, button } = page();
    const send = vi.spyOn(form, "requestSubmit").mockImplementation(() => {});
    initLazyTurnstile(document, async () => ({
      render(_box, options) {
        (options as Options).callback("token-sync");
        return undefined;
      },
    }));

    expect(submit(form, button).defaultPrevented).toBe(true);
    await flush();
    expect(box.querySelector<HTMLInputElement>("input[name='cf-turnstile-response']")?.value).toBe("token-sync");
    // The callback released the held submit once; the failure does not send it twice.
    expect(send).toHaveBeenCalledTimes(1);
    expect(submit(form, button).defaultPrevented).toBe(false);
  });

  describe("when the script never loads", () => {
    it("holds the submit until the fallback timer, then sends without a token", async () => {
      vi.useFakeTimers();
      const { form, box, button } = page();
      initLazyTurnstile(document, () => new Promise<TurnstileApi>(() => {}));
      const send = vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

      expect(submit(form, button).defaultPrevented).toBe(true);
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
      expect(send).not.toHaveBeenCalled();
      expect(statusOf(box).textContent).toBe(HELD_MESSAGE);

      await vi.advanceTimersByTimeAsync(1);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(button);
      expect(statusOf(box).textContent).toBe("");
      // Later submits go straight through.
      expect(submit(form, button).defaultPrevented).toBe(false);
    });

    it("also gives up when only focus started the load", async () => {
      vi.useFakeTimers();
      const { form, email, button } = page();
      initLazyTurnstile(document, () => new Promise<TurnstileApi>(() => {}));
      const send = vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

      email.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(submit(form, button).defaultPrevented).toBe(true);
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
      expect(send).toHaveBeenCalledTimes(1);
      expect(submit(form, button).defaultPrevented).toBe(false);
    });

    // #514: giving up on a held submit is not giving up on the page view.
    it("renders a script that arrives after a held submit was released", async () => {
      vi.useFakeTimers();
      const { form, box, button } = page();
      const { api, renders, token } = fakeApi();
      let arrive!: (api: TurnstileApi) => void;
      initLazyTurnstile(document, () => new Promise<TurnstileApi>((resolve) => (arrive = resolve)));
      const send = vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

      submit(form, button);
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
      expect(send).toHaveBeenCalledTimes(1);
      // While the script is still missing, a submit is not held again.
      expect(submit(form, button).defaultPrevented).toBe(false);

      arrive(api);
      await vi.advanceTimersByTimeAsync(0);
      expect(renders).toHaveLength(1);
      token();
      expect(send).toHaveBeenCalledTimes(1);
      expect(box.querySelector<HTMLInputElement>("input[name='cf-turnstile-response']")!.value).toBe("token-1");
      expect(submit(form, button).defaultPrevented).toBe(false);
    });
  });

  describe("when the script is slow and no submit is waiting (#514)", () => {
    it("renders a script that arrives at 20 s, and the first submit carries its token", async () => {
      vi.useFakeTimers();
      const { form, box, email, button } = page();
      const { api, renders, token } = fakeApi();
      initLazyTurnstile(document, () => new Promise<TurnstileApi>((resolve) => setTimeout(() => resolve(api), 20_000)));
      const send = vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

      email.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(20_000);
      expect(renders).toHaveLength(1);
      token();
      const first = submit(form, button);
      expect(first.defaultPrevented).toBe(false);
      expect(box.querySelector<HTMLInputElement>("input[name='cf-turnstile-response']")!.value).toBe("token-1");
      expect(send).not.toHaveBeenCalled();
    });

    it("gives a submit made at 14 s its own wait, so a script at 20 s still serves it", async () => {
      vi.useFakeTimers();
      const { form, email, button } = page();
      const { api, renders, token } = fakeApi();
      initLazyTurnstile(document, () => new Promise<TurnstileApi>((resolve) => setTimeout(() => resolve(api), 20_000)));
      const send = vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

      email.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(14_000);
      expect(submit(form, button).defaultPrevented).toBe(true);
      await vi.advanceTimersByTimeAsync(6_000);
      expect(renders).toHaveLength(1);
      expect(send).not.toHaveBeenCalled();
      token();
      expect(send).toHaveBeenCalledTimes(1);
      // The released wait is gone: nothing sends again at 29 s.
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("does not time out a script that loaded in time", async () => {
      vi.useFakeTimers();
      const { form, email, button } = page();
      const { api, token } = fakeApi();
      initLazyTurnstile(document, async () => api);
      const send = vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

      email.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS * 2);
      // The widget is ready and waiting on its challenge, so the submit waits.
      expect(submit(form, button).defaultPrevented).toBe(true);
      expect(send).not.toHaveBeenCalled();
      token();
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe("the live message", () => {
    it("sits beside the box as a polite status, empty until a submit is held", async () => {
      const { box } = page();
      initLazyTurnstile(document, async () => fakeApi().api);
      const status = statusOf(box);
      expect(status.getAttribute("role")).toBe("status");
      expect(status.getAttribute("aria-live")).toBe("polite");
      expect(status.classList.contains("visually-hidden")).toBe(true);
      expect(status.textContent).toBe("");
    });

    it("appears while a submit is held and clears when the token arrives", async () => {
      const { form, box, email, button } = page();
      const { api, token } = fakeApi();
      initLazyTurnstile(document, async () => api);
      vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

      email.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await flush();
      // Starting on the form says nothing; only a held submit does.
      expect(statusOf(box).textContent).toBe("");
      submit(form, button);
      expect(statusOf(box).textContent).toBe("Checking you are a person. One moment.");

      token();
      expect(statusOf(box).textContent).toBe("");
    });

    it("clears when the challenge errors", async () => {
      const { form, box, button } = page();
      const { api, renders } = fakeApi();
      initLazyTurnstile(document, async () => api);
      vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

      submit(form, button);
      await flush();
      expect(statusOf(box).textContent).toBe(HELD_MESSAGE);
      renders[0]!.options["error-callback"]();
      expect(statusOf(box).textContent).toBe("");
    });

    it("clears when the script fails to load", async () => {
      const { form, box, button } = page();
      initLazyTurnstile(document, () => Promise.reject(new Error("blocked")));
      vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

      submit(form, button);
      expect(statusOf(box).textContent).toBe(HELD_MESSAGE);
      await flush();
      expect(statusOf(box).textContent).toBe("");
    });

    it("says nothing for a submit that is not held", async () => {
      const { form, box, button } = page();
      const { api, token } = fakeApi();
      initLazyTurnstile(document, async () => api);
      vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

      submit(form, button);
      await flush();
      token();
      expect(submit(form, button).defaultPrevented).toBe(false);
      expect(statusOf(box).textContent).toBe("");
    });
  });
});

describe("loadTurnstile", () => {
  beforeEach(() => {
    vi.resetModules();
    document.head.innerHTML = "";
    delete (window as { turnstile?: unknown }).turnstile;
  });

  it("adds one explicit-render script and resolves with window.turnstile", async () => {
    const { loadTurnstile, TURNSTILE_SRC } = await import("../../../src/components/forms/turnstile");
    const first = loadTurnstile();
    const second = loadTurnstile();
    const scripts = document.head.querySelectorAll("script");
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.src).toBe(TURNSTILE_SRC);
    expect(TURNSTILE_SRC).toBe("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");

    const api = fakeApi().api;
    (window as { turnstile?: TurnstileApi }).turnstile = api;
    scripts[0]!.dispatchEvent(new Event("load"));
    await expect(first).resolves.toBe(api);
    await expect(second).resolves.toBe(api);
  });

  it("reuses the API the Resourcus panel already loaded", async () => {
    const { loadTurnstile } = await import("../../../src/components/forms/turnstile");
    const api = fakeApi().api;
    (window as { turnstile?: TurnstileApi }).turnstile = api;
    await expect(loadTurnstile()).resolves.toBe(api);
    expect(document.head.querySelector("script")).toBeNull();
  });

  it("rejects when the script loads but defines no API", async () => {
    const { loadTurnstile } = await import("../../../src/components/forms/turnstile");
    const loading = loadTurnstile();
    document.head.querySelector("script")!.dispatchEvent(new Event("load"));
    await expect(loading).rejects.toThrow("turnstile missing");
  });
});
