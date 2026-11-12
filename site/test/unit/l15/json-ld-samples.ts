// L15: the known-bad and known-clean samples for the JSON-LD escape. Shared by
// test/unit/l15/json-ld.test.ts and test/dom/l15/head.test.ts.

// Known-bad: every field tries a different way out of the script element.
export const ATTACK = {
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  headline: "Launch night </script><script>alert(1)</script>",
  description: "Mixed case </SCRIPT > and a comment opener <!-- here",
  author: { "@type": "Person", name: "</script\t><img src=x onerror=alert(1)>" },
};

// Known-clean: no "<", so the escape must change nothing.
export const CLEAN = { "@context": "https://schema.org", "@type": "AboutPage", name: "Team & keepers > guests" };
