// Open-source plan, phase 1 (#552): the people overlay. A deploy never ships
// fixtures, a dev build gets fixtures, a deploy reads the R2 bundle, and a
// committed people.yaml (this archive repo) is left alone. Known-bad and
// known-clean samples, with a fake wrangler, never the network.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ARCHIVE_MARKER, ARCHIVE_REPO, imageKind, isDeploy, PATHS, r2Object, Refused, resolvePeople, unbundle } from "../../../../scripts/people/overlay.mjs";
import { tempDirs } from "../temp-dirs";

const REPO = path.resolve(import.meta.dirname, "../../../..");
const tempDir = tempDirs();

/** A repo root with the fixtures and an empty photos folder, nothing else. */
function bareRepo(): string {
  const root = tempDir("cs-people-");
  cpSync(path.join(REPO, PATHS.fixtures), path.join(root, PATHS.fixtures), { recursive: true });
  mkdirSync(path.join(root, "data/team"), { recursive: true });
  mkdirSync(path.join(root, PATHS.photos), { recursive: true });
  return root;
}

// The first bytes of a real WebP file: "RIFF", a size, "WEBP".
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

const REAL_YAML = "- id: real-one\n  name: Real One\n  title: T\n  group: leadership\n  bio: b\n  photo: real-one\n";
const b64 = (bytes: Uint8Array | string) => Buffer.from(bytes).toString("base64");

/** A fake wrangler: answers a get with the bundle, records each call. Pass a bundle, or a failing exit status. */
function fakeR2({ bundle, status }: { bundle?: unknown; status?: number } = {}) {
  const calls: string[][] = [];
  const r2 = (args: string[]) => {
    calls.push(args);
    if (status) throw Object.assign(new Error("wrangler failed"), { status });
    if (args[0] === "get") return Buffer.from(typeof bundle === "string" ? bundle : JSON.stringify(bundle ?? { people: REAL_YAML, photos: { "real-one.webp": b64(WEBP) } }));
    return Buffer.from("");
  };
  return Object.assign(r2, { calls });
}
const noR2 = fakeR2({ status: 1 });

/** A committed people.yaml with its photo, as a contributor or the archive would have it. */
const commit = (root: string) => {
  writeFileSync(path.join(root, PATHS.people), "- id: kept\n  name: Kept\n");
  writeFileSync(path.join(root, PATHS.photos, "kept.webp"), "x");
};
const markArchive = (root: string) => {
  mkdirSync(path.join(root, "04_tools"), { recursive: true });
  writeFileSync(path.join(root, ARCHIVE_MARKER), "{}");
};

// A dev, test or CI build asks for fixtures by name (#695).
const DEV = { CS_PEOPLE_FIXTURES: "1" };

const source = (root: string) => readFileSync(path.join(root, PATHS.marker), "utf8").trim();
const photos = (root: string) => readdirSync(path.join(root, PATHS.photos)).sort();

describe("people overlay: known-bad", () => {
  it("refuses a Workers Builds deploy that cannot read R2", async () => {
    await expect(resolvePeople({ root: bareRepo(), env: { WORKERS_CI: "1" }, r2: noR2 })).rejects.toThrow(/could not read R2/);
  });

  it("refuses a deploy over fixtures an earlier dev run left", async () => {
    const root = bareRepo();
    await resolvePeople({ root, env: DEV });
    await expect(resolvePeople({ root, env: { WORKERS_CI: "1" }, r2: noR2 })).rejects.toThrow(/could not read R2/);
  });

  // #653: the five holes that open at the public cutover.
  it("reads R2 over a committed people.yaml outside the archive (a file a PR added)", async () => {
    const root = bareRepo();
    commit(root);
    expect(await resolvePeople({ root, env: { WORKERS_CI: "1" }, r2: fakeR2() })).toBe("r2");
    expect(readFileSync(path.join(root, PATHS.people), "utf8")).toContain("Real One");
  });

  it("refuses a deploy outside the archive that has only a committed people.yaml", async () => {
    const root = bareRepo();
    commit(root);
    await expect(resolvePeople({ root, env: { WORKERS_CI: "1" }, r2: noR2 })).rejects.toThrow(/could not read R2/);
  });

  it("treats WORKERS_CI=true, CF_PAGES and CS_PEOPLE_REQUIRE as deploys, and 0, false, no as not", async () => {
    for (const env of [{ WORKERS_CI: "true" }, { CF_PAGES: "1" }, { CS_PEOPLE_REQUIRE: "1" }]) {
      expect(isDeploy(env), JSON.stringify(env)).toBe(true);
      await expect(resolvePeople({ root: bareRepo(), env, r2: noR2 })).rejects.toThrow(Refused);
    }
    for (const env of [{}, { WORKERS_CI: "0" }, { CF_PAGES: "false" }, { CS_PEOPLE_REQUIRE: "no" }]) expect(isDeploy(env)).toBe(false);
  });

  it("writes its marker first, so a run cut short is never read as committed", async () => {
    const root = bareRepo();
    rmSync(path.join(root, PATHS.photos), { recursive: true });
    writeFileSync(path.join(root, PATHS.photos), "a file where the photos folder goes: the run fails midway");
    await expect(resolvePeople({ root, env: DEV })).rejects.toThrow();
    expect(existsSync(path.join(root, PATHS.marker))).toBe(true);
    await expect(resolvePeople({ root, env: { WORKERS_CI: "1" }, r2: noR2 })).rejects.toThrow(Refused);
  });

  it("refuses a bundle that is not JSON, lacks its parts, or holds an odd photo", async () => {
    const run = (bundle: unknown) => resolvePeople({ root: bareRepo(), env: { WORKERS_CI: "1" }, r2: fakeR2({ bundle }) });
    await expect(run("<!doctype html><title>error</title>")).rejects.toThrow(/not JSON/);
    await expect(run({ people: REAL_YAML })).rejects.toThrow(/needs people and photos/);
    await expect(run({ people: REAL_YAML, photos: { "real-one.webp": b64("<html>") } })).rejects.toThrow(/not a WEBP image/);
    await expect(run({ people: REAL_YAML, photos: { "../x.webp": b64(WEBP) } })).rejects.toThrow(/plain photo name/);
    expect(() => unbundle(Buffer.from("[]"))).toThrow(Refused);
  });

  it("refuses an odd CS_PEOPLE_R2 before any wrangler call", async () => {
    const r2 = fakeR2();
    for (const CS_PEOPLE_R2 of ["cs-people", "cs-people/../x", "--remote/x", "CS-People/people.json", "cs-people/.env", "a/b"]) {
      await expect(resolvePeople({ root: bareRepo(), env: { WORKERS_CI: "1", CS_PEOPLE_R2 }, r2 }), CS_PEOPLE_R2).rejects.toThrow(/not a bucket\/key/);
    }
    expect(r2.calls).toEqual([]);
    expect(r2Object({})).toBe("cs-people/people.json");
  });

  it("fails when wrangler cannot read R2, and never falls back to fixtures", async () => {
    const root = bareRepo();
    await expect(resolvePeople({ root, env: { WORKERS_CI: "1" }, r2: fakeR2({ status: 1 }) })).rejects.toThrow(/exited 1/);
    expect(existsSync(path.join(root, PATHS.people))).toBe(false);
  });
});

// #695: the four holes left for the public cutover.
describe("people overlay: known-bad, #695", () => {
  it("refuses a run that is no deploy and asks for no fixtures: fixtures only for CS_PEOPLE_FIXTURES=1", async () => {
    for (const env of [{}, { CS_PEOPLE_FIXTURES: "true" }, { CS_PEOPLE_FIXTURES: "0" }]) {
      const root = bareRepo();
      await expect(resolvePeople({ root, env }), JSON.stringify(env)).rejects.toThrow(/CS_PEOPLE_FIXTURES=1/);
      expect(existsSync(path.join(root, PATHS.people))).toBe(false);
    }
  });

  it("never follows a planted symlink when it writes a photo, people.yaml or its marker", async () => {
    const root = bareRepo();
    const outside = tempDir("cs-people-outside-");
    const targets = ["photo-target", "people-target", "marker-target"].map((n) => path.join(outside, n));
    for (const f of targets) writeFileSync(f, "untouched");
    symlinkSync(targets[0], path.join(root, PATHS.photos, "ada-example.png"));
    symlinkSync(targets[1], path.join(root, PATHS.people));
    symlinkSync(targets[2], path.join(root, PATHS.marker));
    // The marker symlink makes the run treat what it finds as its own, so no committed file shields it.
    expect(await resolvePeople({ root, env: DEV })).toBe("fixtures");
    for (const f of targets) expect(readFileSync(f, "utf8"), f).toBe("untouched");
    for (const rel of [path.join(PATHS.photos, "ada-example.png"), PATHS.people, PATHS.marker]) {
      expect(lstatSync(path.join(root, rel)).isSymbolicLink(), rel).toBe(false);
    }
  });

  it("refuses a photos folder that is a symlink", async () => {
    const root = bareRepo();
    const outside = tempDir("cs-people-outside-");
    rmSync(path.join(root, PATHS.photos), { recursive: true });
    symlinkSync(outside, path.join(root, PATHS.photos));
    await expect(resolvePeople({ root, env: DEV })).rejects.toThrow(/symlink/);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("refuses the archive marker in a GitHub Actions run of any other repo", async () => {
    const root = bareRepo();
    commit(root);
    markArchive(root);
    for (const GITHUB_REPOSITORY of ["Colorado-Startups/coloradostartups", "someone/fork"]) {
      await expect(resolvePeople({ root, env: { GITHUB_REPOSITORY, ...DEV } })).rejects.toThrow(/only Colorado-Startups\/coloradostartups-site/);
    }
  });
});

// #795: follow-ups from the #695 reviews.
describe("people overlay: known-bad, #795", () => {
  it("refuses a parent folder that a symlink takes outside the repo, and writes nothing there", async () => {
    for (const parent of ["data/team", "site/src/components/team"]) {
      const root = bareRepo();
      const outside = tempDir("cs-people-outside-");
      rmSync(path.join(root, parent), { recursive: true });
      symlinkSync(outside, path.join(root, parent));
      await expect(resolvePeople({ root, env: DEV }), parent).rejects.toThrow(/resolves outside the repo/);
      expect(readdirSync(outside), parent).toEqual([]);
    }
  });
});

// #795: production is deployed by hand, so the build path never asks for fixtures.
describe("the build path", () => {
  const namesFlag = (script?: string) => /CS_PEOPLE_FIXTURES/.test(script ?? "");
  const scripts = (file: string): Record<string, string> => JSON.parse(readFileSync(path.join(REPO, file), "utf8")).scripts;

  it("self-check: the test spots the flag in a script", () => {
    expect(namesFlag("CS_PEOPLE_FIXTURES=1 node ../scripts/people/overlay.mjs && node scripts/sync-brand.mjs")).toBe(true);
    expect(namesFlag("node ../scripts/people/overlay.mjs && node scripts/sync-brand.mjs")).toBe(false);
  });

  it("never sets CS_PEOPLE_FIXTURES in a script a build runs", () => {
    const site = scripts("site/package.json");
    const root = scripts("package.json");
    for (const [where, script] of Object.entries({
      "site prebuild": site.prebuild,
      "site build": site.build,
      "site postbuild": site.postbuild,
      "root prebuild": root.prebuild,
      "root build": root.build,
      "root postbuild": root.postbuild,
    })) {
      expect(namesFlag(script), where).toBe(false);
    }
    expect(site.prebuild, "the overlay still runs before a build").toMatch(/scripts\/people\/overlay\.mjs/);
  });
});

describe("people overlay: known-clean", () => {
  it("builds on fixtures in a GitHub Actions run that is no deploy; a deploy there still reads R2", async () => {
    const root = bareRepo();
    expect(await resolvePeople({ root, env: { GITHUB_ACTIONS: "true" } })).toBe("fixtures");
    expect(await resolvePeople({ root, env: { GITHUB_ACTIONS: "true", WORKERS_CI: "1" }, r2: fakeR2() })).toBe("r2");
    await expect(resolvePeople({ root: bareRepo(), env: { GITHUB_ACTIONS: "1" } })).rejects.toThrow(/CS_PEOPLE_FIXTURES=1/);
  });

  it("copies the fixtures for a dev build and marks them", async () => {
    const root = bareRepo();
    expect(await resolvePeople({ root, env: DEV })).toBe("fixtures");
    expect(source(root)).toBe("fixtures");
    expect(photos(root)).toEqual(["ada-example.png", "lee-lorem.png", "pat-placeholder.png", "sam-sample.png"]);
  });

  it("reads the R2 bundle in a deploy, and replaces fixtures it wrote", async () => {
    const root = bareRepo();
    await resolvePeople({ root, env: DEV });
    const r2 = fakeR2();
    expect(await resolvePeople({ root, env: { WORKERS_CI: "1" }, r2 })).toBe("r2");
    expect(r2.calls).toEqual([["get", "cs-people/people.json", "--pipe"]]);
    expect(source(root)).toBe("r2");
    expect(photos(root)).toEqual(["real-one.webp"]);
    expect(readFileSync(path.join(root, PATHS.people), "utf8")).toContain("Real One");
  });

  it("leaves the archive repo's committed people.yaml and its photos alone, in a deploy too, and reads no R2", async () => {
    const root = bareRepo();
    commit(root);
    markArchive(root);
    const r2 = fakeR2();
    expect(await resolvePeople({ root, env: { WORKERS_CI: "1" }, r2 })).toBe("committed");
    expect(r2.calls).toEqual([]);
    expect(photos(root)).toEqual(["kept.webp"]);
    expect(existsSync(path.join(root, PATHS.marker))).toBe(false);
  });

  it("seeds R2 from the archive's committed data only in a deploy with CS_PEOPLE_R2_SEED=1", async () => {
    const root = bareRepo();
    commit(root);
    markArchive(root);
    const r2 = fakeR2();
    expect(await resolvePeople({ root, env: { CS_PEOPLE_R2_SEED: "1" }, r2 })).toBe("committed");
    expect(r2.calls).toEqual([]);
    expect(await resolvePeople({ root, env: { WORKERS_CI: "1", CS_PEOPLE_R2_SEED: "1" }, r2 })).toBe("committed");
    expect(r2.calls.map((c) => c.slice(0, 2))).toEqual([["put", "cs-people/people.json"]]);
    expect(r2.calls[0]).toContain("--file");
    await expect(resolvePeople({ root, env: { WORKERS_CI: "1", CS_PEOPLE_R2_SEED: "1" }, r2: fakeR2({ status: 1 }) })).rejects.toThrow(/could not write R2/);
  });

  it("keeps the archive's committed people.yaml in the archive's own GitHub Actions run", async () => {
    const root = bareRepo();
    commit(root);
    markArchive(root);
    expect(await resolvePeople({ root, env: { GITHUB_REPOSITORY: ARCHIVE_REPO } })).toBe("committed");
  });

  it("uses a hand-made people.yaml in local dev outside the archive", async () => {
    const root = bareRepo();
    commit(root);
    expect(await resolvePeople({ root, env: {} })).toBe("committed");
  });

  it("knows WebP, PNG and JPEG by their first bytes, and nothing else", () => {
    expect(imageKind(WEBP)).toBe("webp");
    expect(imageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(imageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(imageKind(Buffer.from("<html>"))).toBeNull();
  });
});

describe("fixtures", () => {
  // The public export has no real people.yaml, so there is nobody to compare.
  it.skipIf(!existsSync(path.join(REPO, PATHS.people)))("name nobody from the real people.yaml", () => {
    const real = readFileSync(path.join(REPO, PATHS.people), "utf8");
    const fixtures = readFileSync(path.join(REPO, PATHS.fixtures, "people.yaml"), "utf8");
    for (const [, name] of fixtures.matchAll(/^\s+name: (.+)$/gm)) expect(real).not.toContain(name);
  });
});
