// L15: what BaseLayout puts in every page's <head>, checked two ways.
//   1. A self-test through jsdom's HTML parser: escaped JSON-LD stays one
//      script element, and the unescaped known-bad sample breaks out, so the
//      check can see a break-out when there is one.
//   2. Over the built site (run `npm run build` first; test:content does):
//      every JSON-LD block has no "<" and parses, every page links both
//      feeds for discovery, and the JSON-LD across the site describes one
//      Colorado Startups (GO-LIVE C3; with its own self-test).
import { describe, expect, it } from "vitest";

import { jsonLdText } from "../../../src/layouts/json-ld";
import { ATTACK } from "../../unit/l15/json-ld-samples";
import { contentPages } from "../pages";
import { ON_FIXTURES } from "../../people-source";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const pageWith = (scriptText: string) =>
  `<!doctype html><html><head><script type="application/ld+json">${scriptText}</script></head>` +
  `<body><p id="after">after</p></body></html>`;

describe("JSON-LD in a real HTML parser", () => {
  it("self-test: unescaped, the known-bad sample closes the tag and injects a script", () => {
    const doc = parse(pageWith(JSON.stringify(ATTACK)));
    const scripts = doc.querySelectorAll("script");
    expect(scripts.length).toBeGreaterThan(1);
    expect(scripts[1]?.textContent).toBe("alert(1)");
    expect(() => JSON.parse(scripts[0]!.textContent ?? "")).toThrow();
  });

  it("escaped, it stays one script element whose text parses to the same value", () => {
    const doc = parse(pageWith(jsonLdText(ATTACK)));
    const scripts = doc.querySelectorAll("script");
    expect(scripts).toHaveLength(1);
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.getElementById("after")?.textContent).toBe("after");
    expect(JSON.parse(scripts[0]!.textContent ?? "")).toEqual(ATTACK);
  });
});

describe("<head> on the built pages", () => {
  const pages = contentPages();

  it("has JSON-LD on some pages, so the next check is not empty", () => {
    expect(pages.filter((p) => p.html.includes("application/ld+json")).length).toBeGreaterThan(0);
  });

  it("writes every JSON-LD block with no '<', and each one parses", () => {
    for (const page of pages) {
      for (const script of parse(page.html).querySelectorAll("script[type='application/ld+json']")) {
        const raw = script.textContent ?? "";
        expect(raw, page.route).not.toContain("<");
        expect(() => JSON.parse(raw), page.route).not.toThrow();
      }
    }
  });

  it("links the JSON feed and the RSS feed from every page", () => {
    for (const page of pages) {
      const head = parse(page.html).head;
      const json = head.querySelector("link[rel='alternate'][type='application/feed+json']");
      const rss = head.querySelector("link[rel='alternate'][type='application/rss+xml']");
      expect(json?.getAttribute("href"), page.route).toBe("/feed.json");
      expect(rss?.getAttribute("href"), page.route).toBe("/rss.xml");
      expect(rss?.getAttribute("title"), page.route).toBe("Colorado Startups dispatches");
    }
  });
});

// GO-LIVE C3: the site describes one Colorado Startups. Every Organization node
// carries the home page's @id, and every reference points at a node that some
// page declares in full. A node declares its @id only when it carries facts
// beyond these keys; a node with only these keys (a bare {"@id"}, or a stub
// such as org.ts's organizationRef) is a reference and must resolve.
const ORG_ID = "https://coloradostartups.org/#organization";
const REFERENCE_KEYS = new Set(["@id", "@type", "name", "url"]);

function entityProblems(blocks: { route: string; ld: unknown }[]): string[] {
  const declared = new Set<string>();
  const refs: { route: string; id: string }[] = [];
  const problems: string[] = [];
  const visit = (node: unknown, route: string): void => {
    if (Array.isArray(node)) return node.forEach((n) => visit(n, route));
    if (node === null || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const id = obj["@id"];
    if (typeof id === "string") {
      if (Object.keys(obj).some((key) => !REFERENCE_KEYS.has(key))) declared.add(id);
      else refs.push({ route, id });
    }
    if (obj["@type"] === "Organization" && id !== ORG_ID) {
      problems.push(`${route}: an Organization without the home page's @id`);
    }
    for (const value of Object.values(obj)) visit(value, route);
  };
  for (const { route, ld } of blocks) visit(ld, route);
  for (const { route, id } of refs) if (!declared.has(id)) problems.push(`${route}: ${id} is declared on no page`);
  return problems;
}

describe("one entity graph across the site", () => {
  it("self-test: flags an unlinked Organization, a dangling @id and a lone stub, and passes a linked graph", () => {
    const bad = {
      "@type": "BlogPosting",
      publisher: { "@type": "Organization", name: "Colorado Startups" },
      isPartOf: { "@id": "https://coloradostartups.org/#nowhere" },
    };
    expect(entityProblems([{ route: "/bad/", ld: bad }])).toHaveLength(2);

    // A four-key stub names the Organization but declares nothing, so on its
    // own it is a dangling reference, not the Organization.
    const stub = { "@type": "Organization", "@id": ORG_ID, name: "Colorado Startups", url: "https://coloradostartups.org/" };
    const post = { "@type": "BlogPosting", author: stub, publisher: stub };
    expect(entityProblems([{ route: "/post/", ld: post }])).toEqual([
      `/post/: ${ORG_ID} is declared on no page`,
      `/post/: ${ORG_ID} is declared on no page`,
    ]);

    const home = { "@graph": [{ "@type": "Organization", "@id": ORG_ID, name: "Colorado Startups", foundingDate: "2014" }] };
    const team = { "@type": "AboutPage", mainEntity: { "@id": ORG_ID } };
    const linked = [
      { route: "/", ld: home },
      { route: "/team/", ld: team },
      { route: "/post/", ld: post },
    ];
    expect(entityProblems(linked)).toEqual([]);
  });

  // A regex, not a second jsdom parse of every page: jsonLdText leaves no "<"
  // inside a block (the check above proves it on the built pages), so
  // [^<]* captures each block whole.
  it("gives every Organization the home page's @id, and every @id reference resolves", () => {
    const blocks = contentPages().flatMap((page) =>
      [...page.html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([^<]*)<\/script>/g)].map((m) => ({
        route: page.route,
        ld: JSON.parse(m[1]!) as unknown,
      })),
    );
    // The regex missed no block: one match per ld+json script on the page.
    const tagCount = contentPages().reduce((n, page) => n + page.html.split("application/ld+json").length - 1, 0);
    expect(blocks).toHaveLength(tagCount);
    expect(blocks.map((b) => b.route)).toContain("/");
    // On fixtures the Team page shows fake people, so a reference to a real person's card has no target.
    const problems = entityProblems(blocks).filter((p) => !(ON_FIXTURES && /\/team\/#[a-z0-9-]+ is declared on no page$/.test(p)));
    expect(problems).toEqual([]);
  });
});
