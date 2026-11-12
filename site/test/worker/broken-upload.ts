import { expect } from "vitest";

// A form POST whose body breaks off mid-read. readBodyCapped turns that into
// null, and every form route answers it with ?error=invalid (#319).
//
// The answer alone cannot prove a route never read a body: a limit check
// placed between readFormCapped and its null check reads the body and still
// answers ?error=ratelimit. So sendBrokenUploads also records
// request.bodyUsed, which turns true once readBodyCapped starts reading. A
// test asserts that no rate-limited request was read (#351), and that every
// invalid one was, which shows bodyUsed tracks a read at all.
export function brokenUpload(url: string, ip: string): Request {
  return new Request(url, {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("name=Sam&website="));
        c.error(new Error("connection reset"));
      },
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": ip },
    // @ts-expect-error duplex is required for a streamed request body
    duplex: "half",
    redirect: "manual",
  });
}

export interface BrokenUploadAnswer {
  location: string | null;
  read: boolean;
}

/** Sends `count` broken uploads from one IP through `send`, in order. */
export async function sendBrokenUploads(
  count: number,
  url: string,
  ip: string,
  send: (request: Request) => Promise<Response>,
): Promise<BrokenUploadAnswer[]> {
  const answers: BrokenUploadAnswer[] = [];
  for (let i = 0; i < count; i += 1) {
    const request = brokenUpload(url, ip);
    const response = await send(request);
    answers.push({ location: response.headers.get("Location"), read: request.bodyUsed });
  }
  return answers;
}

/**
 * Every answer is invalid or ratelimit. The invalid ones were read, which also
 * shows bodyUsed tracks a read here; the ratelimit ones were never read.
 */
export function expectLimitedBeforeRead(answers: BrokenUploadAnswer[], invalidLocation: string, ratelimitLocation: string): void {
  const invalid = answers.filter((a) => a.location === invalidLocation);
  const limited = answers.filter((a) => a.location === ratelimitLocation);
  expect(answers.length - invalid.length - limited.length, "answers that were neither invalid nor ratelimit").toBe(0);
  expect(invalid.length, "posts under the limit answered invalid").toBeGreaterThan(0);
  expect(invalid.filter((a) => !a.read).length, "invalid answers whose body was not read").toBe(0);
  expect(limited.length, "posts over the limit answered ratelimit").toBeGreaterThan(0);
  expect(limited.filter((a) => a.read).length, "ratelimit answers whose body was read").toBe(0);
}
