import { http, HttpResponse } from "msw";

// L6's MSW handler factories for Kit v4 and Turnstile. Each factory records
// the requests it saw so a test can assert what the Worker sent.

export interface Seen {
  path: string;
  apiKey: string | null;
  body: Record<string, unknown>;
}

export function kitHandlers(opts: { create?: number; addToForm?: number; network?: boolean } = {}) {
  const seen: Seen[] = [];
  const record = async (request: Request) => {
    seen.push({
      path: new URL(request.url).pathname,
      apiKey: request.headers.get("X-Kit-Api-Key"),
      body: (await request.json()) as Record<string, unknown>,
    });
  };
  const reply = (status: number) =>
    status >= 400
      ? HttpResponse.json({ errors: ["synthetic failure"] }, { status })
      : HttpResponse.json({ subscriber: { id: 1, state: "inactive" } }, { status });

  const handlers = [
    http.post("https://api.kit.com/v4/subscribers", async ({ request }) => {
      await record(request);
      if (opts.network) return HttpResponse.error();
      return reply(opts.create ?? 201);
    }),
    http.post("https://api.kit.com/v4/forms/:formId/subscribers", async ({ request }) => {
      await record(request);
      if (opts.network) return HttpResponse.error();
      return reply(opts.addToForm ?? 201);
    }),
  ];
  return { handlers, seen };
}

export function turnstileHandler(success: boolean) {
  return http.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", () =>
    HttpResponse.json({ success }),
  );
}
