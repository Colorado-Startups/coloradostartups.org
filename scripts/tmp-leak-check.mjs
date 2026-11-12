#!/usr/bin/env node
// Runs a command with TMPDIR set to a fresh, empty folder, then fails if the
// command left anything in it (#332). The fresh folder is removed either way,
// so a run never adds to the pile in the real TMPDIR, leaks or not. Other
// sessions writing to the real TMPDIR at the same time cannot disturb the count.
//
//   node scripts/tmp-leak-check.mjs <command> [args...]   run it and check
//   node scripts/tmp-leak-check.mjs --self-test           seeded known-bad and known-clean runs
//
// `npm run check:push` runs through it (root package.json), so it fires in
// the site-tests workflow, and check:push runs this self-test first. No git
// hook runs either (Paul, 2026-11-02: no testing on the Mac).
// `npm run lint:selftest` runs the self-test too.
//
// Node's module compile cache would land in TMPDIR as node-compile-cache. It
// is a cache by design, not a leak, so the command runs with
// NODE_DISABLE_COMPILE_CACHE=1. Nothing else is exempt.
//
// Interrupts (#361). INT, TERM and HUP are trapped before the fresh folder
// exists. The command runs in its own process group, and each signal goes to
// that whole group: npm's `sh -c "a && b"` would not pass a signal on to the
// step it is running, so signalling npm alone let the chain finish. Ctrl-C in
// a terminal reaches the wrapper and is passed on the same way, and so is the
// hangup a closing terminal sends, which the command's own group never gets
// (#376). Once the command exits, the folder is removed and the wrapper exits
// 128 plus the signal number, with no leak report, since an interrupted run
// never reached its own cleanup. An exit handler removes the folder on any
// other way out.
//
// Exit codes. The wrapper is transparent: the command's own code stands, so a
// failing test fails the push exactly as it did before.
//   0    the command passed and left nothing
//   1    the command passed and left entries in TMPDIR (each is named)
//   2    usage error: no command
//   127  the command could not start (pre-push reads 127 as INFRA)
//   130  interrupted by INT; 143 by TERM; 129 by HUP
//   any other code is the command's own
// Could not check fails open: when the fresh folder cannot be made or read,
// it warns, runs the command plainly and returns the command's code.

import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = "usage: node scripts/tmp-leak-check.mjs <command> [args...] | --self-test";
const TRAPPED = ["SIGINT", "SIGTERM", "SIGHUP"];
const SCRIPT = fileURLToPath(import.meta.url);

const signalCode = (sig) => 128 + (constants.signals[sig] ?? 0);

export async function check(argv, { log = console.error, stdio = "inherit" } = {}) {
  if (argv.length === 0) {
    log(USAGE);
    return 2;
  }
  // Traps first, so no signal can land between making the folder and
  // being ready to remove it.
  let interrupted = null;
  let child = null;
  const traps = TRAPPED.map((sig) => [
    sig,
    () => {
      interrupted ??= sig;
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid, sig);
        } catch {
          child.kill(sig);
        }
      }
    },
  ]);
  for (const [sig, fn] of traps) process.on(sig, fn);

  // Resolves to the command's exit code, or 127 when it could not start.
  const run = (env) =>
    new Promise((resolve) => {
      let settled = false;
      const done = (code) => {
        if (!settled) resolve(code);
        settled = true;
      };
      child = spawn(argv[0], argv.slice(1), { stdio, env, detached: true });
      child.once("error", (err) => {
        log(`INFRA [tmp-leak-check]: could not start ${argv[0]}: ${err.message}`);
        done(127);
      });
      child.once("exit", (code, signal) => done(code ?? signalCode(signal)));
    });

  let fresh = null;
  const remove = () => {
    if (fresh) rmSync(fresh, { recursive: true, force: true });
  };
  process.on("exit", remove);
  try {
    try {
      fresh = mkdtempSync(path.join(tmpdir(), "cs-tmp-check-"));
    } catch (err) {
      log(`INFRA [tmp-leak-check]: could not make a fresh temp folder (${err.message}); running without the check`);
      if (interrupted) return signalCode(interrupted);
      const status = await run(process.env);
      return interrupted ? signalCode(interrupted) : status;
    }
    if (interrupted) return signalCode(interrupted);
    const status = await run({ ...process.env, TMPDIR: fresh, NODE_DISABLE_COMPILE_CACHE: "1" });
    if (interrupted) {
      log(`INTERRUPTED [tmp-leak-check]: ${interrupted}; the fresh TMPDIR is removed and no leak is counted`);
      return signalCode(interrupted);
    }
    let left;
    try {
      left = readdirSync(fresh).sort();
    } catch (err) {
      log(`INFRA [tmp-leak-check]: could not read ${fresh} (${err.message}); the leak count is unknown`);
      return status;
    }
    if (left.length > 0) {
      log(`FAIL [tmp-leak-check]: the run left ${left.length} ${left.length === 1 ? "entry" : "entries"} in TMPDIR. Remove each in afterEach or finally:`);
      for (const name of left) log(`  ${name}`);
    }
    if (status !== 0) return status;
    return left.length > 0 ? 1 : 0;
  } finally {
    remove();
    process.off("exit", remove);
    for (const [sig, fn] of traps) process.off(sig, fn);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Starts this script on a command that never ends, signals it once its fresh
// folder exists, and reports the exit code, whether the sandbox is empty and
// whether the command was stopped too.
async function interrupt(sig, sandbox) {
  const pidFile = `${sandbox}.pid`;
  const forever = `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`;
  const wrapper = spawn(process.execPath, [SCRIPT, process.execPath, "-e", forever], {
    env: { ...process.env, TMPDIR: sandbox },
    stdio: "ignore",
  });
  const exited = new Promise((r) => wrapper.once("exit", (code, signal) => r(code ?? signalCode(signal))));
  const ready = () => {
    try {
      return readdirSync(sandbox).some((n) => n.startsWith("cs-tmp-check-")) && readFileSync(pidFile, "utf8").length > 0;
    } catch {
      return false;
    }
  };
  for (let waited = 0; !ready(); waited += 50) {
    if (waited > 15_000) {
      // The command runs detached, so killing the wrapper does not stop it.
      wrapper.kill("SIGKILL");
      try {
        process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL");
      } catch {
        // No pid file yet, or the command is already gone.
      }
      rmSync(pidFile, { force: true });
      return { code: "no fresh folder within 15 s", left: [], commandAlive: false };
    }
    await sleep(50);
  }
  const commandPid = Number(readFileSync(pidFile, "utf8"));
  wrapper.kill(sig);
  const code = await exited;
  let commandAlive = true;
  try {
    process.kill(commandPid, 0);
  } catch {
    commandAlive = false;
  }
  if (commandAlive) process.kill(commandPid, "SIGKILL");
  rmSync(pidFile, { force: true });
  return { code, left: readdirSync(sandbox), commandAlive };
}

// Seeds known-bad and known-clean runs in a sandbox TMPDIR, then checks the
// sandbox is empty: the check removes its fresh folder even when it finds a leak.
async function selfTest() {
  const node = process.execPath;
  const leaves = `require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "seeded-leak-"))`;
  const cleans = `const fs = require("fs"); fs.rmSync(fs.mkdtempSync(require("path").join(require("os").tmpdir(), "seeded-clean-")), { recursive: true })`;
  const realTmp = process.env.TMPDIR;
  const sandbox = mkdtempSync(path.join(tmpdir(), "cs-tmp-check-selftest-"));
  const cases = [
    ["known-bad: a passing command that leaves a folder", [node, "-e", leaves], 1, sandbox],
    ["known-clean: a passing command that removes its folder", [node, "-e", cleans], 0, sandbox],
    ["a failing command keeps its own code", [node, "-e", "process.exit(4)"], 4, sandbox],
    ["usage: no command", [], 2, sandbox],
    ["a program that does not exist exits 127", ["cs-tmp-check-no-such-program"], 127, sandbox],
    ["could not check fails open: no TMPDIR to write, the command still runs", [node, "-e", "process.exit(5)"], 5, path.join(sandbox, "missing", "deeper")],
  ];
  let wrong = 0;
  const report = (ok, line) => {
    if (!ok) wrong += 1;
    console.log(`  ${ok ? "OK  " : "FAIL"} ${line}`);
  };
  try {
    for (const [name, argv, want, tmp] of cases) {
      process.env.TMPDIR = tmp;
      const got = await check(argv, { log: () => {}, stdio: "ignore" });
      report(got === want, `${name}: exit ${got}${got === want ? "" : `, expected ${want}`}`);
    }
    for (const [sig, want] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
      const got = await interrupt(sig, sandbox);
      const ok = got.code === want && got.left.length === 0 && !got.commandAlive;
      report(ok, `${sig} mid-run exits ${got.code}, removes the fresh folder${got.left.length ? ` (left: ${got.left.join(", ")})` : ""} and stops the command${got.commandAlive ? " (it was still running)" : ""}${ok ? "" : `; expected exit ${want}, nothing left, command stopped`}`);
    }
    const left = readdirSync(sandbox);
    report(left.length === 0, `the check leaves nothing itself${left.length === 0 ? "" : `: ${left.join(", ")}`}`);
  } finally {
    if (realTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = realTmp;
    rmSync(sandbox, { recursive: true, force: true });
  }
  console.log(`tmp-leak-check self-test: ${wrong === 0 ? "PASS" : `FAIL (${wrong})`}`);
  return wrong === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
  const args = process.argv.slice(2);
  const code = await (args[0] === "--self-test" ? selfTest() : check(args));
  process.exit(code);
}
