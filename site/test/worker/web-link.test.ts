// #189: parseWebLink in packages/shared is the one link parser. An applicant's
// links use it at its strictest (parseHttpsLink, tested in
// test/unit/l19/apply-schema.test.ts). A suggested resource uses it with
// http, ports and spaces allowed (normalizeSuggestedUrl). These pin each
// option and each caller's choices.
import { parseHttpsLink, parseWebLink } from "@cs/shared";
import { describe, expect, it } from "vitest";

import { normalizeSuggestedUrl } from "../../worker/routes/suggest-resource";

describe("parseWebLink options", () => {
  const strict = { max: 300 };

  it("keeps the strict side when no option is set", () => {
    expect(parseWebLink("https://example.org/a", strict)).toBe("https://example.org/a");
    expect(parseWebLink("example.org/a", strict)).toBeNull();
    expect(parseWebLink("http://example.org/a", strict)).toBeNull();
    expect(parseWebLink("https://example.org:8443/a", strict)).toBeNull();
    expect(parseWebLink("https://example.org/a b", strict)).toBeNull();
  });

  it("addScheme puts https:// in front of a link typed without a scheme (#138)", () => {
    expect(parseWebLink(" example.org/a ", { ...strict, addScheme: true })).toBe("https://example.org/a");
    expect(parseWebLink("ftp://example.org/a", { ...strict, addScheme: true })).toBeNull();
  });

  it("allowHttp, allowPort and allowWhitespace each open one rule", () => {
    expect(parseWebLink("http://example.org/a", { ...strict, allowHttp: true })).toBe("http://example.org/a");
    expect(parseWebLink("https://example.org:8443/a", { ...strict, allowPort: true })).toBe("https://example.org:8443/a");
    expect(parseWebLink("https://example.org/a b", { ...strict, allowWhitespace: true })).toBe("https://example.org/a%20b");
  });

  it("refuses userinfo and an undotted or dot-ended host under every option", () => {
    const open = { max: 300, addScheme: true, allowHttp: true, allowPort: true, allowWhitespace: true };
    for (const value of ["https://user:pw@example.org/", "https://user@example.org/", "http://localhost:8787/", "https://example.org./"]) {
      expect(parseWebLink(value, open), value).toBeNull();
    }
  });

  it("applies max to the value with its scheme and to the normalized href", () => {
    const at = (n: number) => `https://example.org/${"a".repeat(n - "https://example.org/".length)}`;
    expect(parseWebLink(at(300), strict)).toBe(at(300));
    expect(parseWebLink(at(301), strict)).toBeNull();
    // "https://example.org" normalizes to one character more, with its slash.
    expect(parseWebLink("https://example.org", { max: 19 })).toBeNull();
  });
});

describe("the two callers", () => {
  it("parseHttpsLink adds https:// and allows no http, port or space", () => {
    expect(parseHttpsLink("linkedin.com/in/someone")).toBe("https://linkedin.com/in/someone");
    expect(parseHttpsLink("http://linkedin.com/in/someone")).toBeNull();
    expect(parseHttpsLink("https://linkedin.com:8443/in/someone")).toBeNull();
    expect(parseHttpsLink("https://linkedin.com/in/some one")).toBeNull();
  });

  it("normalizeSuggestedUrl adds https:// and allows http, a port and spaces", () => {
    expect(normalizeSuggestedUrl("acme.example")).toBe("https://acme.example/");
    expect(normalizeSuggestedUrl("http://acme.example/")).toBe("http://acme.example/");
    expect(normalizeSuggestedUrl("https://acme.example:8443/x")).toBe("https://acme.example:8443/x");
    expect(normalizeSuggestedUrl("acme.example/our events")).toBe("https://acme.example/our%20events");
    // singleLine folds a line break into a space before parsing.
    expect(normalizeSuggestedUrl("acme.example/a\r\nb")).toBe("https://acme.example/a%20b");
  });
});
