// S7: lib/guides/credits.ts and the dated snapshot in data/credits/. The built
// page is checked in test/dom/credits/.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  amountHeadline,
  amountLine,
  attributed,
  BUCKETS,
  byBucket,
  CREDITS_GUIDE,
  creditsJsonLd,
  CreditsSnapshotSchema,
  needsSource,
  parseCredits,
  programsCovering,
  shortProvider,
  shownPrograms,
  snapshotDate,
  sourceLabel,
  trainsText,
  type Program,
} from "../../../src/lib/guides/credits";
import { lintStaged, termRuleIds } from "../../../../scripts/canvas/lib/lint.mjs";

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../data/credits/startup-programs.json");
const raw = readFileSync(FILE, "utf8");
const real = parseCredits(raw);
const shown = shownPrograms(real);
const SITE = new URL("https://coloradostartups.org");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const hasPython = spawnSync("python3", ["--version"]).status === 0;

// Every provider the page shows was checked: none is run by a Chinese company
// (S7 brief; decision 80). A new provider joins this set only after that
// check, so a refresh that brings one in fails here until someone makes it.
const REVIEWED_PROVIDERS = new Set([
  "AMD", "Akamai", "Amazon Web Services", "Anthropic", "AssemblyAI", "Baseten", "Cerebras", "Cloudflare",
  "Deepgram", "Denvr Dataworks", "ElevenLabs", "FounderPass", "GitHub", "Google", "Intel", "JetBrains", "Koyeb",
  "Mercury", "Microsoft", "Modal", "MongoDB", "Nebius", "Notion", "OVHcloud", "Oracle", "Ramp", "RunPod",
  "Scaleway", "Secret", "Stripe", "Tenki", "TensorWave", "Together AI", "Vast.ai", "Vercel", "Vultr",
]);

const program = (over: Partial<Program> = {}): Program => ({
  id: "x",
  program: "X",
  provider: "Google",
  bucket: "no_incorporation",
  credit_first: 100,
  credit_max: 100,
  credit_first_computed: false,
  credit_max_computed: false,
  amount_note: "$100 in credits.",
  covers: ["cpu"],
  requirements: ["An account"],
  term: null,
  traps: { card_required: null, expiry: null, overage: "unknown", trains_on_data: null, other: [] },
  link: "https://example.org/",
  source: "https://example.org/terms",
  checked: "2026-11-02",
  ...over,
});
const snap = (rows: unknown[], omit: unknown[] = [], checked = "2026-11-02") => ({
  from: { repo: "o/r", path: "p.json", commit: "927523c" },
  omit,
  export: { version: 1, checked, rows },
});

describe("needsSource and attributed", () => {
  it("flag a bare figure (known bad) and pass an attributed, labeled or figure-free sentence (known clean)", () => {
    expect(needsSource("Under $1M raised.")).toBe(true);
    expect(needsSource("A 20% match on spend.")).toBe(true);
    expect(needsSource("Up to 120,000 hours.")).toBe(true);
    expect(needsSource("Under $1M raised, per Cloudflare.")).toBe(false);
    expect(needsSource("AWS says select participants may get up to $5,000.")).toBe(false);
    expect(needsSource("That buys about 38 hours (computed here).")).toBe(false);
    expect(needsSource("Founded in the last 10 years.")).toBe(false);
  });

  it("adds the provider to each sentence with a bare figure, and leaves the rest alone", () => {
    expect(attributed("Starts at $1,000. Apply online.", "Amazon Web Services")).toBe(
      "Starts at $1,000, per Amazon Web Services. Apply online.",
    );
    expect(attributed("Tier 2: under $5M raised", "Cloudflare")).toBe("Tier 2: under $5M raised, per Cloudflare");
    expect(attributed("No figures here.", "Modal")).toBe("No figures here.");
    expect(attributed("$5 of credit.", "Tenki (Tenki Cloud, LLC, owned by Luxor Technology)")).toBe(
      "$5 of credit, per Tenki.",
    );
  });
});

describe("amountHeadline, sourceLabel and shortProvider", () => {
  it("state the amount from the export's numbers", () => {
    expect(amountHeadline({ credit_first: 300, credit_max: 300 })).toBe("$300");
    expect(amountHeadline({ credit_first: null, credit_max: 200000 })).toBe("Up to $200,000");
    expect(amountHeadline({ credit_first: 200000, credit_max: null })).toBe("From $200,000");
    expect(amountHeadline({ credit_first: 1000, credit_max: 5000 })).toBe("From $1,000, up to $5,000");
    expect(amountHeadline({ credit_first: null, credit_max: null })).toBeNull();
  });

  it("shorten a source URL and a provider name", () => {
    expect(sourceLabel("https://www.cloudflare.com/startups/")).toBe("cloudflare.com/startups");
    expect(sourceLabel("https://modal.com/pricing")).toBe("modal.com/pricing");
    expect(shortProvider("AMD (runs on DigitalOcean)")).toBe("AMD");
    expect(shortProvider("Google")).toBe("Google");
  });
});

describe("amountLine (review of PR #103: never credit a provider with our arithmetic)", () => {
  const line = (over: Partial<Program>) => amountLine(program(over));

  it("keeps a stated amount as stated", () => {
    expect(line({ credit_first: 300, credit_max: 300 })).toEqual({ stated: "$300", computed: null });
  });

  it("splits a stated first amount from a computed total", () => {
    expect(line({ credit_first: 30, credit_max: 360, credit_max_computed: true })).toEqual({
      stated: "From $30",
      computed: "Up to $360 in total (computed here)",
    });
  });

  it("keeps every computed number out of the stated line", () => {
    expect(line({ credit_first: 960, credit_max: 14400, credit_first_computed: true, credit_max_computed: true })).toEqual({
      stated: "No dollar total on the page; see the note",
      computed: "From $960, up to $14,400 in total (computed here)",
    });
    expect(line({ credit_first: null, credit_max: 27500, credit_max_computed: true })).toEqual({
      stated: "No dollar total on the page; see the note",
      computed: "Up to $27,500 in total (computed here)",
    });
  });

  it("says when the page states only euros, or nothing", () => {
    expect(line({ credit_first: null, credit_max: null, amount_note: "EUR 1,000 in cloud credits." }).stated).toBe(
      "Stated in EUR; see the note",
    );
    expect(line({ credit_first: null, credit_max: null }).stated).toBe("Amount not stated");
  });
});

describe("trainsText", () => {
  const traps = (trains_on_data: boolean | null, other: string[] = []) => ({ ...program().traps, trains_on_data, other });

  it("answers only when the page says, and names a stated opt-out", () => {
    expect(trainsText(program({ traps: traps(null) }))).toBeNull();
    expect(trainsText(program({ provider: "Modal", traps: traps(false) }))).toBe("No, per Modal's terms.");
    expect(trainsText(program({ provider: "Deepgram", traps: traps(true) }))).toBe("Yes, per Deepgram's terms.");
    expect(
      trainsText(program({ provider: "Deepgram", traps: traps(true, ["Requests join unless each sets mip_opt_out=true."]) })),
    ).toBe("Yes by default, and you can opt out, per Deepgram's terms.");
    expect(
      trainsText(program({ provider: "ElevenLabs", traps: traps(true, ["Opt out in the Data use menu."]) })),
    ).toBe("Yes by default, and you can opt out, per ElevenLabs' terms.");
  });
});

describe("the snapshot in data/credits/", () => {
  it("parses, names the Compute commit it came from, and fills every group", () => {
    expect(real.from.commit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(shown.length).toBeGreaterThan(10);
    expect(byBucket(shown).map((b) => b.id)).toEqual(BUCKETS.map((b) => b.id));
  });

  it("carries a first-party source and a checked date for every row", () => {
    for (const p of real.export.rows) {
      expect(p.source, p.id).toMatch(/^https:\/\//);
      expect(p.checked <= real.export.checked, p.id).toBe(true);
    }
  });

  it("shows only providers checked against the China rule", () => {
    expect([...new Set(shown.map((p) => shortProvider(p.provider)))].filter((n) => !REVIEWED_PROVIDERS.has(n))).toEqual(
      [],
    );
  });

  it("gives every omission its reason", () => {
    for (const o of real.omit) expect(o.why, o.id).not.toBe("");
  });

  // The real content gate over every shown row's words, with the private rules
  // when this checkout has them, so the test names no private term itself.
  it.skipIf(!hasPython)("leaves out every row the site's term rules warn on", () => {
    const strings = (v: unknown): string[] =>
      typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];
    const prose = (p: Program) => strings({ ...p, link: "", source: "" }).filter(Boolean).join("\n\n");
    const terms = termRuleIds(ROOT);
    const found = lintStaged(
      shown.map((p) => ({ rel: `data/credits/${p.id}.md`, text: `# ${p.id}\n\n${prose(p)}\n` })),
      { repoRoot: ROOT, today: real.export.checked },
    );
    const hits = [...found].flatMap(([id, fs]) => fs.filter((f: { check: string }) => terms.has(f.check)).map((f: { check: string }) => `${id}: ${f.check}`));
    expect(hits).toEqual([]);
  });

  it("attributes every figure the page shows", () => {
    const fields = (p: Program) => [
      p.amount_note,
      ...p.requirements,
      p.term ?? "",
      p.traps.expiry ?? "",
      ...p.traps.other,
    ];
    for (const p of shown) {
      for (const field of fields(p)) {
        const bare = attributed(field, p.provider)
          .split(/(?<=[.!?])\s+/)
          .filter(needsSource);
        expect(bare, p.id).toEqual([]);
      }
    }
  });

  // Review of PR #103: a sentence the page credits to a provider must not be
  // our own arithmetic. These phrases mark arithmetic; the export must label
  // such a sentence "(computed here)" instead.
  it("never credits a provider with a computed sentence", () => {
    const ARITHMETIC = /\bsum\b|buys about|that is \$|twelve months/i;
    for (const p of shown) {
      const fields = [p.amount_note, ...p.requirements, p.term ?? "", p.traps.expiry ?? "", ...p.traps.other];
      for (const sentence of fields.flatMap((f) => f.split(/(?<=[.!?])\s+/))) {
        if (attributed(sentence, p.provider) !== sentence) expect(sentence, p.id).not.toMatch(ARITHMETIC);
      }
    }
  });

  it("keeps every computed amount out of the stated amount line", () => {
    const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
    for (const p of shown) {
      const { stated } = amountLine(p);
      if (p.credit_first_computed && p.credit_first !== null) expect(stated, p.id).not.toContain(usd(p.credit_first));
      if (p.credit_max_computed && p.credit_max !== null) expect(stated, p.id).not.toContain(usd(p.credit_max));
    }
  });

  it("documents how to refresh it from the Compute repo's public export", () => {
    expect(JSON.parse(raw)._README.join(" ")).toMatch(/startup-programs\.public\.json/);
  });
});

describe("the schema", () => {
  it("passes a clean snapshot (known clean)", () => {
    expect(CreditsSnapshotSchema.safeParse(snap([program()])).success).toBe(true);
  });

  it("refuses repeated ids, a later check date, an http link, a first amount over the max and a stale omit (known bad)", () => {
    expect(CreditsSnapshotSchema.safeParse(snap([program(), program()])).success).toBe(false);
    expect(CreditsSnapshotSchema.safeParse(snap([program({ checked: "2026-11-03" })])).success).toBe(false);
    expect(CreditsSnapshotSchema.safeParse(snap([program({ link: "http://example.org/" })])).success).toBe(false);
    expect(CreditsSnapshotSchema.safeParse(snap([program({ credit_first: 500, credit_max: 100 })])).success).toBe(false);
    expect(CreditsSnapshotSchema.safeParse(snap([program({ covers: [] })])).success).toBe(false);
    expect(CreditsSnapshotSchema.safeParse(snap([program()], [{ id: "gone", why: "x" }])).success).toBe(false);
  });

  it("throws on a bad file, so the build stops instead of shipping a wrong table", () => {
    expect(() => parseCredits("{")).toThrow();
    expect(() => parseCredits(JSON.stringify(snap([])))).toThrow();
  });
});

describe("shownPrograms, byBucket and programsCovering", () => {
  it("drops omitted rows and keeps export order inside a group", () => {
    const a = program({ id: "a", bucket: "incorporated" });
    const b = program({ id: "b" });
    const c = program({ id: "c", bucket: "incorporated" });
    const s = CreditsSnapshotSchema.parse(snap([a, b, c], [{ id: "b", why: "test" }]));
    expect(shownPrograms(s).map((p) => p.id)).toEqual(["a", "c"]);
    expect(byBucket(shownPrograms(s)).map((g) => [g.id, g.programs.map((p) => p.id)])).toEqual([["company", ["a", "c"]]]);
  });

  it("finds the programs that name a kind of compute", () => {
    expect(programsCovering([program({ covers: ["cpu", "gpu"] }), program({ id: "y" })], "gpu").map((p) => p.id)).toEqual([
      "x",
    ]);
  });
});

describe("snapshotDate and creditsJsonLd", () => {
  it("states the export date in Denver", () => {
    expect(snapshotDate(CreditsSnapshotSchema.parse(snap([program()])))).toEqual({
      label: "November 2, 2026",
      iso: "2026-11-02",
    });
  });

  it("lists every shown program once, in page order, by its official link", () => {
    const ld = creditsJsonLd(real, SITE) as {
      url: string;
      numberOfItems: number;
      itemListElement: { name: string; url: string; position: number }[];
    };
    const order = byBucket(shown).flatMap((b) => b.programs);
    expect(ld.url).toBe(`https://coloradostartups.org${CREDITS_GUIDE.path}`);
    expect(ld.numberOfItems).toBe(shown.length);
    expect(ld.itemListElement.map((e) => e.name)).toEqual(order.map((p) => p.program));
    expect(ld.itemListElement.map((e) => e.url)).toEqual(order.map((p) => p.link));
    expect(ld.itemListElement.map((e) => e.position)).toEqual(order.map((_, i) => i + 1));
  });
});
