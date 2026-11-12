import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  cleanLists,
  consentMapFrom,
  hashEmail,
  insideGitCheckout,
  optOutHashesFrom,
  parseCsv,
  toCsv,
  UsageError,
  // @ts-expect-error plain .mjs ops module without type declarations
} from "../../../../ops/email/clean-lib.mjs";

// Synthetic fixtures only (example.org is reserved, RFC 2606). Real exports
// never enter this repository.
const HEADER = ["Email", "First Name", "Accepts Marketing"];
const input = (tag: string, rows: string[][]) => ({ name: `${tag}.csv`, tag, rows: [HEADER, ...rows] });

describe("cleanLists", () => {
  it("imports only valid, consenting, unsuppressed addresses, tagged by list", () => {
    const suppression = new Set([hashEmail("gone@example.org")]);
    const { files, counts, newSuppression } = cleanLists(
      [
        input("Founders CO", [
          ["A@Example.org ", "Ada", "true"],
          ["a@example.org", "Ada", "true"],
          ["no@example.org", "Nia", "false"],
          ["gone@example.org", "Gil", "true"],
          ["not-an-email", "X", "true"],
        ]),
        input("startupers", [["a@example.org", "", "yes"], ["b@example.org", "Bo", "true"]]),
      ],
      suppression,
    );
    expect(files.get("founders-co")).toEqual([["email", "first_name"], ["a@example.org", "Ada"]]);
    expect(files.get("startupers")).toEqual([["email", "first_name"], ["a@example.org", ""], ["b@example.org", "Bo"]]);
    expect(counts).toMatchObject({ rows: 7, invalid: 1, optedOut: 1, suppressed: 1, duplicateInTag: 1, written: 3, unique: 2 });
    expect([...newSuppression]).toEqual([hashEmail("no@example.org")]);
  });

  it("keeps an address out everywhere once any list says it opted out", () => {
    const { files, counts } = cleanLists(
      [input("one", [["c@example.org", "", "true"]]), input("two", [["C@example.org", "", "false"]])],
      new Set(),
    );
    expect(files.get("one")).toEqual([["email", "first_name"]]);
    expect(counts.unique).toBe(0);
  });

  it("refuses an export with no consent column instead of assuming consent", () => {
    expect(() => cleanLists([{ name: "x.csv", tag: "x", rows: [["Email"], ["d@example.org"]] }], new Set())).toThrow(
      UsageError,
    );
  });
});

describe("consent from a Profiles export", () => {
  const consent = consentMapFrom([
    HEADER,
    ["k@example.org", "", "true"],
    ["l@example.org", "", "false"],
    ["m@example.org", "", "true"],
    ["M@example.org", "", "false"],
  ]);
  it("lets a list export without a consent column borrow it, and any no wins", () => {
    const { files, counts } = cleanLists(
      [{ name: "list.csv", tag: "list", rows: [["Email"], ["k@example.org"], ["l@example.org"], ["m@example.org"], ["n@example.org"]] }],
      new Set(),
      consent,
    );
    expect(files.get("list")).toEqual([["email", "first_name"], ["k@example.org", ""]]);
    expect(counts).toMatchObject({ optedOut: 2, noConsentRecord: 1, unique: 1 });
  });
});

describe("review fixes: every opt-out source wins", () => {
  it("Profiles false + list true is not written", () => {
    const consent = consentMapFrom([HEADER, ["p@example.org", "", "false"]]);
    const { files, counts, newSuppression } = cleanLists([input("list", [["p@example.org", "Pat", "true"]])], new Set(), consent);
    expect(files.get("list")).toEqual([["email", "first_name"]]);
    expect(counts.optedOut).toBe(1);
    expect(newSuppression.has(hashEmail("p@example.org"))).toBe(true);
  });

  it("Profiles opt-outs grow suppression even when no list mentions them", () => {
    const consent = consentMapFrom([HEADER, ["q@example.org", "", "false"], ["r@example.org", "", "true"]]);
    const { newSuppression } = cleanLists([input("list", [["r@example.org", "", "true"]])], new Set(), consent);
    expect([...newSuppression]).toEqual([hashEmail("q@example.org")]);
  });

  it("an unsubscribed export only suppresses, whatever its other columns say", () => {
    const optOuts = optOutHashesFrom([HEADER, ["S@example.org", "", "true"], ["bad", "", "true"]]);
    expect([...optOuts]).toEqual([hashEmail("s@example.org")]);
    const { files, counts, newSuppression } = cleanLists(
      [input("list", [["s@example.org", "", "true"], ["t@example.org", "", "true"]])],
      new Set(),
      null,
      optOuts,
    );
    expect(files.get("list")).toEqual([["email", "first_name"], ["t@example.org", ""]]);
    expect(counts.suppressed).toBe(1);
    expect(newSuppression.has(hashEmail("s@example.org"))).toBe(true);
  });
});

describe("CSV handling", () => {
  it("parses quotes, embedded commas and newlines, and a BOM", () => {
    expect(parseCsv('﻿Email,Note\r\n"e@example.org","a, ""b""\nc"\n')).toEqual([
      ["Email", "Note"],
      ["e@example.org", 'a, "b"\nc'],
    ]);
  });
  it("round-trips through toCsv", () => {
    const rows = [["email", "first_name"], ["f@example.org", 'O"Neil, Jr']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
  it("reports an unterminated quote by line, without the cell", () => {
    expect(() => parseCsv('Email\n"g@example.org')).toThrow(/line 2/);
  });
});

describe("clean-list.mjs CLI", () => {
  const repoRoot = path.resolve(__dirname, "../../../..");
  const cli = path.join(repoRoot, "ops/email/clean-list.mjs");
  const drive = mkdtempSync(path.join(tmpdir(), "l6-drive-"));
  afterAll(() => rmSync(drive, { recursive: true, force: true }));

  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

  it("knows the repo is a git checkout and a temp folder is not", () => {
    expect(insideGitCheckout(path.join(repoRoot, "ops/email/out"))).toBe(true);
    expect(insideGitCheckout(path.join(drive, "out"))).toBe(false);
  });

  it("refuses to write inside the repository", () => {
    const src = path.join(drive, "in.csv");
    writeFileSync(src, toCsv([HEADER, ["h@example.org", "", "true"]]));
    const res = run("--in", src, "--tag", "t", "--suppression", path.join(drive, "s.txt"), "--out-dir", path.join(repoRoot, "local"));
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/refused/);
    expect(existsSync(path.join(repoRoot, "local", "kit-import-t.csv"))).toBe(false);
  });

  it("adds --unsubscribed addresses to suppression without importing them", () => {
    const src = path.join(drive, "list2.csv");
    const unsub = path.join(drive, "unsub.csv");
    writeFileSync(src, toCsv([HEADER, ["u@example.org", "", "true"], ["v@example.org", "", "true"]]));
    writeFileSync(unsub, toCsv([["Email"], ["u@example.org"], ["w@example.org"]]));
    const out = path.join(drive, "out2");
    const supp = path.join(drive, "suppression2.txt");
    const res = run("--in", src, "--tag", "t", "--unsubscribed", unsub, "--suppression", supp, "--out-dir", out);
    expect(res.status).toBe(0);
    expect(readFileSync(path.join(out, "kit-import-t.csv"), "utf8")).toBe("email,first_name\nv@example.org,\n");
    expect(readFileSync(supp, "utf8").trim().split("\n").sort()).toEqual(
      [hashEmail("u@example.org"), hashEmail("w@example.org")].sort(),
    );
  });

  it("writes import files and the suppression file, and prints counts but no address", () => {
    const src = path.join(drive, "list.csv");
    writeFileSync(src, toCsv([HEADER, ["i@example.org", "Ida", "true"], ["j@example.org", "Jo", "false"]]));
    const out = path.join(drive, "out");
    const supp = path.join(drive, "suppression.txt");
    const res = run("--in", src, "--tag", "startupers", "--suppression", supp, "--out-dir", out);
    expect(res.status).toBe(0);
    expect(res.stdout + res.stderr).not.toMatch(/@example\.org/);
    expect(res.stdout).toMatch(/unique addresses to import: 1/);
    expect(readFileSync(path.join(out, "kit-import-startupers.csv"), "utf8")).toBe("email,first_name\ni@example.org,Ida\n");
    expect(readFileSync(supp, "utf8").trim()).toBe(hashEmail("j@example.org"));
  });
});
