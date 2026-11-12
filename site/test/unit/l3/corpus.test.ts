// The corpus sync: document building, the diff, the Items API client and a
// dry run over the full committed data set. Every network call goes to a fake.
import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tempDirs } from "../temp-dirs";
import {
  buildDocuments,
  documentText,
  hashText,
  idFromKey,
  keyFor,
  KEY_PREFIX,
  planSync,
  readRecords,
} from "../../../../scripts/canvas/lib/corpus.mjs";
import { itemsClient } from "../../../../scripts/canvas/lib/items-api.mjs";
import { main } from "../../../../scripts/canvas/sync-corpus.mjs";

const tempDir = tempDirs();

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const DATA = path.join(ROOT, "data/resources");

const rec = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Name ${id}`,
  url: `https://${id}.example/`,
  stage: "launch",
  substage: "develop",
  city: "Denver",
  type: "accelerator",
  description: "Mentorship-driven accelerator program in Denver.",
  tags: ["accelerator"],
  source: "canvas-2026",
  status: "active",
  ...extra,
});

describe("documents", () => {
  it("hold no URL, so the model never sees a link it could repeat", () => {
    const text = documentText(rec("acme"));
    expect(text).not.toMatch(/https?:|www\.|\.example/);
    expect(text).toContain("Resource id: acme");
  });

  it("are keyed by id and content hash, and the key round-trips to the id", () => {
    const [doc] = buildDocuments([rec("acme")]);
    expect(doc.key).toBe(keyFor("acme", hashText(doc.text)));
    expect(doc.key).toMatch(/^cs-resource--acme--[0-9a-f]{16}\.md$/);
    expect(idFromKey(doc.key)).toBe("acme");
    expect(idFromKey("notes.md")).toBeNull();
    expect(doc.metadata).toEqual({ resource_id: "acme", stage: "launch", type: "accelerator", city: "Denver" });
  });

  it("change key when the content changes, and only then", () => {
    const a = buildDocuments([rec("acme")])[0].key;
    expect(buildDocuments([rec("acme")])[0].key).toBe(a);
    expect(buildDocuments([rec("acme", { city: "Boulder" })])[0].key).not.toBe(a);
  });

  it("cover active records only and refuse a broken one", () => {
    const docs = buildDocuments([rec("a"), rec("b", { status: "review" }), rec("c", { status: "dead" })]);
    expect(docs.map((d: { id: string }) => d.id)).toEqual(["a"]);
    expect(() => buildDocuments([rec("x", { description: "" })])).toThrow(/missing description/);
    expect(() => buildDocuments([rec("x"), rec("x")])).toThrow(/duplicate/);
  });
});

describe("planSync", () => {
  const docs = buildDocuments([rec("keep"), rec("change", { city: "Golden" }), rec("new"), rec("broken")]);
  const key = (id: string): string => docs.find((d: { id: string }) => d.id === id)?.key ?? "";
  const remote = [
    { id: "i1", key: key("keep"), status: "completed" },
    { id: "i2", key: keyFor("change", "0000000000000000"), status: "completed" },
    { id: "i3", key: keyFor("gone", "1111111111111111"), status: "completed" },
    { id: "i4", key: key("broken"), status: "error" },
    { id: "i5", key: "handbook.md", status: "completed" },
  ];
  const plan = planSync(docs, remote);

  it("uploads what is missing or failed, and deletes orphans and stale versions", () => {
    expect(plan.upload.map((d: { id: string }) => d.id).sort()).toEqual(["broken", "change", "new"]);
    expect(plan.remove.map((i: { id: string }) => i.id).sort()).toEqual(["i2", "i3"]);
    expect(plan.retry.map((i: { id: string }) => i.id)).toEqual(["i4"]);
    expect(plan.unchanged).toBe(1);
  });

  it("never touches a key without its prefix", () => {
    expect(plan.ignored).toBe(1);
    expect([...plan.remove, ...plan.retry].every((i: { key: string }) => i.key.startsWith(KEY_PREFIX))).toBe(true);
  });
});

type Call = { method: string; url: string; body?: FormData };
function fakeApi(pages: unknown[][]) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: { method: string; body?: FormData }) => {
    calls.push({ method: init.method, url, body: init.body });
    if (init.method === "GET") {
      const page = Number(new URL(url).searchParams.get("page"));
      const result = pages[page - 1] ?? [];
      return new Response(JSON.stringify({ success: true, result, result_info: { total_count: pages.flat().length } }));
    }
    return new Response(JSON.stringify({ success: true, result: { warnings: [{ code: "custom_metadata_field_not_filterable", field: "stage" }] } }));
  };
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe("itemsClient", () => {
  it("pages through the list and uploads multipart with a key and metadata", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => ({ id: `p1-${i}`, key: `k${i}` }));
    const api = fakeApi([page1, [{ id: "p2-0", key: "last" }]]);
    const client = itemsClient({ accountId: "acct", token: "t", instance: "resourcus-staging", fetchImpl: api.fetchImpl });
    expect((await client.list()).length).toBe(51);
    expect(api.calls[0].url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct/ai-search/namespaces/default/instances/resourcus-staging/items?page=1&per_page=50",
    );
    const warnings = await client.upload("cs-resource--a--0123456789abcdef.md", "# A\n", { resource_id: "a" });
    expect(warnings[0].code).toBe("custom_metadata_field_not_filterable");
    const up = api.calls.at(-1);
    expect(up?.method).toBe("POST");
    expect((up?.body?.get("file") as File).name).toBe("cs-resource--a--0123456789abcdef.md");
    expect(JSON.parse(String(up?.body?.get("metadata")))).toEqual({ resource_id: "a" });
  });

  it("refuses an instance name the API would reject", () => {
    expect(() => itemsClient({ accountId: "a", token: "t", instance: "../x" })).toThrow(/not valid/);
  });
});

describe("sync-corpus main()", () => {
  const quiet = () => {};

  it("passes a dry run over the full data set without credentials", async () => {
    const lines: string[] = [];
    const code = await main(["resourcus-staging", "--dry-run"], { env: {}, log: (s) => lines.push(s) });
    expect(code).toBe(0);
    const active = readRecords(DATA).filter((r: { status: string }) => r.status === "active").length;
    expect(lines.join("\n")).toContain(`dry run of ${active} active resources against an empty instance`);
    const docs = buildDocuments(readRecords(DATA));
    expect(new Set(docs.map((d: { key: string }) => d.key)).size).toBe(docs.length);
    expect(docs.every((d: { key: string }) => d.key.length <= 128)).toBe(true);
  });

  it("makes no write call in a dry run, even with credentials", async () => {
    const api = fakeApi([[{ id: "x", key: keyFor("gone", "1111111111111111"), status: "completed" }]]);
    const env = { CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_TOKEN: "t" };
    expect(await main(["resourcus-staging", "--dry-run"], { env, fetchImpl: api.fetchImpl, log: quiet })).toBe(0);
    expect(api.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("uploads before it deletes on a real sync", async () => {
    const dir = tempDir("l3-corpus-");
    const stage = path.join(dir, "launch");
    (await import("node:fs")).mkdirSync(stage);
    writeFileSync(path.join(stage, "acme.yaml"), "id: acme\nname: Acme\nurl: https://acme.example/\nstage: launch\nsubstage: develop\ncity: Denver\ntype: accelerator\ndescription: Accelerator in Denver.\ntags: []\nsource: cs\nstatus: active\n");
    const api = fakeApi([[{ id: "old", key: keyFor("gone", "1111111111111111"), status: "completed" }]]);
    const env = { CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_TOKEN: "t" };
    expect(await main(["resourcus-staging"], { env, fetchImpl: api.fetchImpl, dataDir: dir, log: quiet })).toBe(0);
    expect(api.calls.map((c) => c.method)).toEqual(["GET", "POST", "DELETE"]);
    expect(api.calls[2].url).toMatch(/\/items\/old$/);
  });

  it("refuses to write from CI and without credentials", async () => {
    expect(await main(["resourcus-staging"], { env: { CI: "true", CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" }, log: quiet })).toBe(2);
    expect(await main(["resourcus-staging"], { env: {}, log: quiet })).toBe(2);
    expect(await main(["Bad Name", "--dry-run"], { env: {}, log: quiet })).toBe(2);
  });
});
