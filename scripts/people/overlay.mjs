#!/usr/bin/env node
// People overlay (open-source plan, phase 1, issue #552). The public repo
// ships fixtures with fake names; the real Team data lives in a private R2
// object, cs-people/people.json by default. This step puts one or the other
// where the site reads it:
//
//   data/team/people.yaml
//   site/src/components/team/photos/
//
// First match wins (#653):
//
//   | Source      | When                                                       | Then                          |
//   | ----------- | ---------------------------------------------------------- | ----------------------------- |
//   | committed   | the archive repo (04_tools/.private-overlay-required), and | nothing: people.yaml is       |
//   |             | people.yaml is there with no marker                        | committed there               |
//   | r2          | a deploy: WORKERS_CI, CF_PAGES or CS_PEOPLE_REQUIRE set to | read the R2 object; exit 1 if |
//   |             | anything but 0, false or no                                | it cannot: never fixtures     |
//   | committed   | people.yaml is there with no marker, outside a deploy      | nothing (a hand-made file)    |
//   | fixtures    | CS_PEOPLE_FIXTURES=1, or a GitHub Actions run (no Actions  | copy data/fixtures/team/      |
//   |             | job deploys the site): dev, tests, CI builds (#695)        |                               |
//   | refused     | anything else                                              | exit 1                        |
//
// Outside the archive a deploy reads R2 over a committed people.yaml, so a file
// a pull request added never reaches a deploy. The archive marker counts only
// in the archive: a GitHub Actions run in any other repo (GITHUB_REPOSITORY)
// refuses one, so a pull request that adds it fails the public repo's checks
// (#695).
//
// CS_PEOPLE_R2 (default cs-people/people.json) names the bucket and key. The
// object is {"people": "<people.yaml text>", "photos": {"<name>": "<base64>"}}.
// It is read with `wrangler r2 object get --remote --pipe`, which Workers
// Builds' own login authorizes: no key is set anywhere. A failed read fails
// the run, so a deploy never falls back to fixtures. Each photo name must be
// plain and each photo's bytes a real WebP, PNG or JPEG.
//
// In the archive, CS_PEOPLE_R2_SEED=1 on a deploy writes the committed data to
// that object first (ops/runbooks/people-r2.md), so the archive stays the one
// place the data is edited.
//
// Each write removes what is there first and creates the file anew, so a
// symlink a pull request planted is never followed (#695), and each target's
// folder must resolve inside the repo (#795). It writes
// data/team/.people-source (r2 or fixtures) before what it writes, so tests that name real people skip on fixtures
// (site/test/people-source.ts), and a run cut short never leaves files the
// next run would take for committed ones.
//
// Usage:  node scripts/people/overlay.mjs
// Exit:   0 ready, 1 refused or the read failed, 3 could not check.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IMAGE = /\.(webp|png|jpg)$/;
// A photo name in the R2 bundle: no folder, no leading dot.
const PHOTO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(webp|png|jpg)$/;
// An R2 bucket name, then a plain key: never a path or a flag.
const OBJECT = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const DEFAULT_OBJECT = "cs-people/people.json";
/** The tracked file that marks this checkout as the private archive repo (#624). */
export const ARCHIVE_MARKER = "04_tools/.private-overlay-required";
/** The archive repo, the one place ARCHIVE_MARKER may be (#552: the public repo is a fresh one). */
export const ARCHIVE_REPO = "Colorado-Startups/coloradostartups-site";

export const PATHS = {
  people: "data/team/people.yaml",
  photos: "site/src/components/team/photos",
  marker: "data/team/.people-source",
  fixtures: "data/fixtures/team",
};

export class Refused extends Error {}

/** True for a deploy build: any of these set to anything but 0, false or no. */
export function isDeploy(env) {
  const on = (v) => v !== undefined && v !== "" && !/^(0|false|no)$/i.test(String(v));
  return on(env.WORKERS_CI) || on(env.CF_PAGES) || on(env.CS_PEOPLE_REQUIRE);
}

/** The image type the bytes start with, or null: WebP, PNG and JPEG only. */
export function imageKind(bytes) {
  const b = Buffer.from(bytes);
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  return null;
}

/** The people.yaml text as records, or a Refused error that says what is wrong. */
function checkPeople(text, photoNames) {
  const people = parse(text);
  if (!Array.isArray(people) || people.length === 0) throw new Refused("people.yaml holds no people");
  for (const p of people) {
    if (!p || typeof p.id !== "string" || typeof p.name !== "string") throw new Refused("a person has no id or name");
    if (p.photo && !photoNames.has(p.photo)) throw new Refused(`${p.id}: no photo named ${p.photo}`);
  }
  return people;
}

/** wrangler, from the site workspace where it is installed, for one R2 object. */
function wrangler(args, input) {
  return execFileSync("npx", ["--no-install", "wrangler", "r2", "object", ...args, "--remote"], {
    cwd: path.join(ROOT, "site"),
    input,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** The R2 object's name, checked. */
export function r2Object(env) {
  const object = env.CS_PEOPLE_R2 || DEFAULT_OBJECT;
  if (!OBJECT.test(object)) throw new Refused(`CS_PEOPLE_R2 is not a bucket/key: ${JSON.stringify(object)}`);
  return object;
}

/** The bundle's people.yaml text and photos, or a Refused error that says what is wrong. */
export function unbundle(raw) {
  let bundle;
  try {
    bundle = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch {
    throw new Refused("the R2 object is not a people bundle (not JSON)");
  }
  if (typeof bundle?.people !== "string" || !bundle.photos || typeof bundle.photos !== "object") {
    throw new Refused("the R2 object is not a people bundle: it needs people and photos");
  }
  const photos = new Map();
  for (const [name, b64] of Object.entries(bundle.photos)) {
    if (!PHOTO_NAME.test(name)) throw new Refused(`photos/${name}: not a plain photo name`);
    const bytes = Buffer.from(String(b64), "base64");
    const want = name.split(".").pop().toLowerCase();
    if (imageKind(bytes) !== want) throw new Refused(`photos/${name} is not a ${want.toUpperCase()} image`);
    photos.set(name, bytes);
  }
  return { people: bundle.people, photos };
}

/** The archive's committed data as a bundle. */
function bundle(root) {
  const dir = path.join(root, PATHS.photos);
  const photos = Object.fromEntries(
    readdirSync(dir).filter((f) => PHOTO_NAME.test(f)).map((f) => [f, readFileSync(path.join(dir, f)).toString("base64")]),
  );
  return JSON.stringify({ people: readFileSync(path.join(root, PATHS.people), "utf8"), photos });
}

/** Reads the R2 object; a failed read is refused, never fixtures. */
function readR2(object, r2) {
  try {
    return unbundle(r2(["get", object, "--pipe"]));
  } catch (err) {
    if (err instanceof Refused) throw err;
    throw new Refused(`could not read R2 ${object}: wrangler exited ${err.status ?? "?"}`);
  }
}

/** Writes the committed data to the R2 object, from a temp file never in the repo. */
function seedR2(root, object, r2) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cs-people-"));
  const file = path.join(dir, "people.json");
  try {
    writeFileSync(file, bundle(root));
    r2(["put", object, "--file", file, "--content-type", "application/json"]);
  } catch (err) {
    throw new Refused(`could not write R2 ${object}: wrangler exited ${err.status ?? "?"}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readFixtures(root) {
  const dir = path.join(root, PATHS.fixtures);
  const photos = new Map(
    readdirSync(path.join(dir, "photos"))
      .filter((f) => IMAGE.test(f))
      .map((f) => [f, readFileSync(path.join(dir, "photos", f))]),
  );
  return { people: readFileSync(path.join(dir, "people.yaml"), "utf8"), photos };
}

// Removes what is at `file` (a symlink itself, never its target), then
// creates the file anew: "wx" fails rather than follow anything left there.
function writeFresh(root, file, data) {
  insideRoot(root, path.dirname(file));
  rmSync(file, { force: true });
  writeFileSync(file, data, { flag: "wx" });
}

// Refuses a folder whose nearest existing ancestor resolves (realpathSync)
// outside the repo root: a parent such as data/team or
// site/src/components/team that a pull request turned into a symlink (#795).
// Run before mkdirSync, so no folder is made outside the repo either.
function insideRoot(root, dir) {
  const base = realpathSync(root);
  let probe = dir;
  while (!existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const real = realpathSync(probe);
  if (real !== base && !real.startsWith(base + path.sep)) {
    throw new Refused(`${path.relative(root, dir) || "."} resolves outside the repo, to ${real}`);
  }
}

function write(root, source, { people, photos }, hadMarker) {
  const names = new Set([...photos.keys()].map((f) => f.replace(IMAGE, "")));
  checkPeople(people, names);
  // The marker goes first: a run cut short after this leaves files the next
  // run knows are its own, never ones it would take for committed.
  writeFresh(root, path.join(root, PATHS.marker), `${source}\n`);
  const photoDir = path.join(root, PATHS.photos);
  if (existsSync(photoDir) && lstatSync(photoDir).isSymbolicLink()) throw new Refused(`${PATHS.photos} is a symlink`);
  insideRoot(root, photoDir);
  mkdirSync(photoDir, { recursive: true });
  // Only clear photos this script wrote before; a committed photo stays.
  if (hadMarker) for (const f of readdirSync(photoDir).filter((n) => IMAGE.test(n))) rmSync(path.join(photoDir, f));
  for (const [name, bytes] of photos) writeFresh(root, path.join(photoDir, name), bytes);
  writeFresh(root, path.join(root, PATHS.people), people);
}

/**
 * Puts the Team data in place and returns its source. Throws Refused when a
 * deploy would ship fixtures or the R2 object cannot be read.
 */
export async function resolvePeople({ root = ROOT, env = process.env, r2 = wrangler } = {}) {
  const hadMarker = existsSync(path.join(root, PATHS.marker));
  const committed = !hadMarker && existsSync(path.join(root, PATHS.people));
  const archived = existsSync(path.join(root, ARCHIVE_MARKER));
  const ghRepo = env.GITHUB_REPOSITORY;
  if (archived && ghRepo && ghRepo.toLowerCase() !== ARCHIVE_REPO.toLowerCase()) {
    throw new Refused(`${ARCHIVE_MARKER} is in ${ghRepo}: only ${ARCHIVE_REPO} may have it`);
  }
  // The archive repo commits the real people.yaml; that stays its source.
  if (committed && archived) {
    if (isDeploy(env) && env.CS_PEOPLE_R2_SEED === "1") seedR2(root, r2Object(env), r2);
    return "committed";
  }
  if (isDeploy(env)) {
    write(root, "r2", readR2(r2Object(env), r2), hadMarker);
    return "r2";
  }
  if (committed) return "committed";
  // Fixtures only when asked for, or in GitHub Actions, where no job deploys the site
  // (Workers Builds deploys it), so a hand deploy from a laptop fails instead (#695).
  if (env.CS_PEOPLE_FIXTURES !== "1" && env.GITHUB_ACTIONS !== "true") {
    throw new Refused("no people data: a deploy reads R2; set CS_PEOPLE_FIXTURES=1 for a dev, test or CI build");
  }
  write(root, "fixtures", readFixtures(root), hadMarker);
  return "fixtures";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  resolvePeople().then(
    (source) => console.log(`people overlay: ${source}`),
    (err) => {
      const refused = err instanceof Refused;
      console.error(`people overlay: ${refused ? "REFUSED" : "could not check"}: ${err.message}`);
      process.exit(refused ? 1 : 3);
    },
  );
}
