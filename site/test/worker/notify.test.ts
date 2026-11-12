import { describe, expect, it } from "vitest";

import { buildEmailRaw, notify, type SendEmailBinding } from "../../worker/lib/notify";

// notify.ts imports cloudflare:email, so it runs here in workerd, not in the
// plain Node unit project.
describe("buildEmailRaw", () => {
  it("keeps a subject with CR or LF on one header line", () => {
    const raw = buildEmailRaw("Seat application\r\nBcc: someone@example.org", "body");
    const lines = raw.split(/\r?\n/);
    const headers = lines.slice(0, lines.indexOf(""));
    expect(headers.length).toBeGreaterThan(3);
    expect(headers.filter((h) => /^bcc:/i.test(h))).toEqual([]);
    // The subject is one base64 encoded-word.
    const encoded = headers.find((h) => h.startsWith("Subject: "))?.match(/^Subject: =\?utf-8\?B\?(.+)\?=$/i)?.[1];
    expect(encoded && atob(encoded)).toBe("Seat application Bcc: someone@example.org");
  });

  it("writes the headers a mail server expects, each line ending in CRLF", () => {
    const raw = buildEmailRaw("Subject", "body");
    expect(raw).not.toMatch(/[^\r]\n/);
    const headers = raw.slice(0, raw.indexOf("\r\n\r\n")).split("\r\n");
    expect(headers.map((h) => h.slice(0, h.indexOf(":")))).toEqual([
      "Date",
      "From",
      "To",
      "Message-ID",
      "Subject",
      "MIME-Version",
      "Content-Type",
      "Content-Transfer-Encoding",
    ]);
    expect(raw).toMatch(/^Date: \w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} \+0000\r$/m);
    expect(raw).toMatch(/^Message-ID: <[0-9a-f-]{36}@email\.coloradostartups\.org>\r$/m);
  });

  it("keeps an accented, multi-line, long body intact in 76-character base64 lines", () => {
    const body = `Pourquoi: café à Denver\nLine two\n${"a long answer ".repeat(120)}`;
    const raw = buildEmailRaw("Subject", body);
    const lines = raw.slice(raw.indexOf("\r\n\r\n") + 4).split("\r\n");
    expect(lines.every((l) => l.length <= 76)).toBe(true);
    const bytes = Uint8Array.from(atob(lines.join("")), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe(body);
  });

  it("folds a long accented subject into encoded-words of 75 characters or fewer, none splitting a character", () => {
    const subject = `Nomination: ${"Café Économique à Grand Junction, ".repeat(4)}🏔️`;
    const raw = buildEmailRaw(subject, "body");
    const header = raw.slice(raw.indexOf("\r\nSubject: ") + 2, raw.indexOf("\r\nMIME-Version:"));
    const lines = header.split("\r\n");
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.slice(1).every((l) => l.startsWith(" "))).toBe(true);
    const words = lines.map((l) => l.replace(/^(Subject:)? /, ""));
    expect(words.every((w) => /^=\?utf-8\?B\?[A-Za-z0-9+/=]+\?=$/.test(w) && w.length <= 75)).toBe(true);
    // Each word decodes on its own, so no character is cut between two.
    const strict = new TextDecoder("utf-8", { fatal: true });
    const decoded = words.map((w) => strict.decode(Uint8Array.from(atob(w.slice(10, -2)), (c) => c.charCodeAt(0))));
    expect(decoded.join("")).toBe(subject);
  });

  it("ends the headers with a blank line when the body is empty", () => {
    const raw = buildEmailRaw("Subject", "");
    expect(raw.endsWith("Content-Transfer-Encoding: base64\r\n\r\n")).toBe(true);
  });

  it("sends from the forms address to Paul, with no separate Reply-To", () => {
    const raw = buildEmailRaw("Subject", "Line one\nLine two");
    expect(raw).toMatch(/^From: .*<forms@email\.coloradostartups\.org>/m);
    expect(raw).toMatch(/^To: .*paul@coloradostartups\.org/m);
    expect(raw).not.toMatch(/^Reply-To:/im);
  });
});

describe("notify", () => {
  it("does nothing without a binding", async () => {
    await expect(notify(undefined, "s", "b")).resolves.toBeUndefined();
  });

  it("sends one message through the binding", async () => {
    const sent: unknown[] = [];
    const binding: SendEmailBinding = { send: async (m) => void sent.push(m) };
    await notify(binding, "s", "b");
    expect(sent).toHaveLength(1);
  });

  it("never throws when the binding fails", async () => {
    const binding: SendEmailBinding = {
      send: async () => {
        throw new Error("not onboarded");
      },
    };
    await expect(notify(binding, "s", "b")).resolves.toBeUndefined();
  });
});
