#!/usr/bin/env python3
"""contract_test.py: assert the gates, the settings and the prose still agree.

Required by ~/.claude/rules/writing-and-gates.md:

  "Rules belong in data, not in a regex. ... Have a test assert that every
   human-facing surface still agrees with it."
  "Exempt lists are a smell. ... If you need one, it needs its own contract
   test."
  "A comment claiming a call site that the settings file does not wire is a
   defect in its own right. Check the settings file, not the header comment."

cs_site_lint.py --self-test tests each rule. This file tests what goes wrong
between files:

  C1  Every rule has a hit and a miss sample, and the lint self-test passes.
  C2  Shared rules match the LinkedIn sister gate (id, regex, severity,
      case_sensitive, after_expiry). SKIP when that file is absent, as in CI.
  C3  The franchise-name path list (an exempt-list analogue) equals the
      constant below, and every rule path glob lands inside the scope.
  C4  .claude/settings.json denies every gate bypass an agent could reach for.
  C5  Every hook wired in .claude/settings.json and every file in .githooks/
      is named in the gate table (GATE_TABLE, a path-scoped rule since
      2026-11-03) with the right fires/waits wording. FAIL when that file is
      absent, since deleting the table must not pass the contract that
      protects it. C5 has its own seeded samples.
  C6  Every severity in the rules file is FAIL, WARN or off, and the
      voice_lint grades follow "block on the certain, warn on the likely".
  C7  Date windows match the decisions that set them.
  C8  Every wired hook exists, is executable and says in its header where it
      is wired; every hook on disk is wired; the git hooks are executable.
  C9  No workflow reimplements a check inline, each says it is advisory or required, and
      every lint call (not --self-test) starts with bash 04_tools/ci_gate.sh.
      The C9c matcher has its own seeded samples.
  C12 The merge policy's samples pass; every tracked file under .github,
      .githooks, .claude and 04_tools, plus pinned manifests, build files and
      .claude/settings.json, is maintainer-only by an explicit rule; every glob
      in .claude/rules/ai-disclosure.md is maintainer-only, verbatim or under a
      broader folder glob (#552, #626). A gate folder with no tracked files is
      INFRA.
  C13 The export manifest loads (boolean public, non-blank reasons),
      classifies every tracked path (default deny), keeps the plan's left-out
      paths private, and no private path is AI-mergeable unless the overlay
      replaces it (#552, #627). C12 and C13 have seeded bad inputs (C12_BAD,
      C13_BAD), each of which must be flagged.
  C10 Every shared id exists, and every not-lintable rule names who enforces it.
  C11 The private overlay is whole and kept apart. While the required-overlay
      marker (04_tools/.private-overlay-required) is here, the overlay must
      load with the marker's minimum rules and shared ids: a missing or short
      overlay FAILs, so the commit hook blocks it. The public rules file names
      no private rule (no id, regex or hit sample), and no overlay regex
      matches anywhere in it. SKIP with neither file, as in the public repo
      (#552, #624).

The rules come from cs_site_lint.load_rules_data(), so the private overlay is
merged here exactly as the lint merges it.

Usage:  python3 04_tools/contract_test.py
Exit:   0 every contract holds, 1 a contract is broken, 3 could not check.
"""

import json
import os
import re
import subprocess
import sys

# No __pycache__ in the repo: these tools run from hooks on every commit.
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
RULES = os.path.join(HERE, "cs_site_rules.json")
MARKER_NAME = ".private-overlay-required"

EXIT_OK, EXIT_FAIL, EXIT_INFRA = 0, 1, 3

# C3. The franchise-name rule runs only on these paths, so docs that explain
# the ban can name the franchises. Changing the list is a decision: change it
# here and in cs_site_rules.json together.
EXPECTED_FRANCHISE_PATHS = ["data/**", "art/**"]

# C4. Bypasses an agent must not run. A person who needs one runs it in their
# own terminal and says why (house rule: a gate an agent can skip is not a gate).
REQUIRED_DENY = [
    "Bash(git commit --no-verify:*)",
    "Bash(git commit -n:*)",
    "Bash(git push --no-verify:*)",
    "Bash(git push --force:*)",
    "Bash(git push -f:*)",
    "Bash(git push origin main:*)",
    "Bash(git reset --hard:*)",
    # No agent approves a pull request (open-source plan, #552).
    "Bash(gh pr review:*)",
]

# C12. Paths that must stay maintainer-only by an explicit maintainer_only
# rule. Every tracked file under the folders below is checked too, so a new
# hook, workflow or setting is covered, and so are the AI disclosure surfaces
# (a person checks them).
MAINTAINER_ONLY_PINNED = [
    "package.json", "site/package.json", "package-lock.json", "site/wrangler.jsonc",
    "site/astro.config.mjs", "site/worker/index.ts", "workers/communitas/src/index.ts",
    "packages/shared/src/team.ts", "site/migrations/0001_init.sql", "scripts/people/overlay.mjs",
    "data/team/people.yaml", "site/src/content.config.ts", ".claude/settings.json",
]
MAINTAINER_ONLY_DIRS = [".github", ".githooks", ".claude", "04_tools"]
AI_DISCLOSURE_RULE = ".claude/rules/ai-disclosure.md"

# C12 and C13 seeded bad inputs: each is the real policy or manifest with one
# change that must be caught. House rule: every gate ships a self-test with a
# known-bad and a known-clean sample. (label, what it changes, how, glob, a
# probe path the change exposes, so the check never depends on which files a
# checkout tracks: the hook self-test's throwaway repo has no ops/)
C12_BAD = [
    ("data/team/** dropped from maintainer_only", "policy", "drop_maintainer", "data/team/**", "data/team/people.yaml"),
    (".github/** moved to ai_mergeable only", "policy", "move_to_ai", ".github/**", ".github/workflows/site-tests.yml"),
]
C13_BAD = [
    ("data/team/people.yaml flipped to public", "manifest", "make_public", "data/team/people.yaml", "data/team/people.yaml"),
    ("a private path made AI-mergeable", "policy", "add_ai", "ops/**", "ops/canvas-review.md"),
]

# C13. The plan's "Left out" list: these never export.
EXPORT_PRIVATE_PINNED = [
    "04_tools/cs_site_rules.private.json", "04_tools/.private-overlay-required", "data/team/people.yaml",
    "site/src/components/team/photos/sample.webp", "00_project_system/BRIEF.md",
    "ops/canvas-review.md", "ops/artifacts/index.md", "ops/gpu/applications.md",
    "ops/email/runbook.md", "art/workflows/base/sample.json", "data/team/new.yaml",
]


# C6b. voice_lint grades. The dash checks are literal character tests, so they
# block; the rest are heuristics, so they warn.
EXPECTED_VOICE_SEVERITY = {
    "em-dash": "FAIL",
    "spaced-en-dash": "FAIL",
    "unattributed-figure": "WARN",
    "hedge-word": "WARN",
    "ai-tell": "WARN",
    "sentence-length": "WARN",
}

# C7. Windows and what happens after them. Source: LinkedIn
# 04_orchestrator/LOG.md decision 39 (coloradoai.us no-link window extended to
# Nov 10, 2026). The private rules' windows sit in the required-overlay marker,
# with their source, apart from the overlay, and join these when it is present.
EXPECTED_WINDOWS = {
    "coloradoai-link": ({"through": "2026-11-10"}, "off"),
}

PARITY_FIELDS = (("regex", None), ("severity", None),
                 ("case_sensitive", False), ("after_expiry", None))

# C5. Where the gate table lives: a rule that loads only when a gate file is
# open, so the table costs no tokens on other turns.
GATE_TABLE = ".claude/rules/site-gates.md"
# C5. What the gate table must say for each wiring type.
EVENT_WORDS = {
    "SessionStart": ["session start"],
    "SessionEnd": ["session end"],
    "Stop": ["stop"],
    "UserPromptSubmit": ["prompt"],
}
EVENT_BLOCKS = {"PreToolUse": "yes", "PostToolUse": "no", "SessionStart": "no",
                "SessionEnd": "no", "Stop": "no", "UserPromptSubmit": "no"}
GITHOOK_WORDS = {"pre-commit": (["commit"], "yes"), "pre-push": (["push"], "yes"),
                 "commit-msg": (["commit"], "yes")}

# C5. Seeded samples for the gate table check: one wired hook and one git
# hook, a table that names both correctly, and the ways a table goes wrong.
C5_SETTINGS = {"hooks": {"PostToolUse": [{"matcher": "Write|Edit", "hooks": [
    {"command": "bash .claude/hooks/sample-guard.sh"}]}]}}
C5_GITHOOKS = ["pre-commit"]
C5_CLEAN = """| Gate | When | Blocking |
| --- | --- | --- |
| `.claude/hooks/sample-guard.sh` | **Fires** on every Write and Edit | No, advisory |
| `.githooks/pre-commit` | **Fires** on every commit | Yes |
"""
C5_BAD = [
    ("absent gate table", None),
    ("no gate table", "# Project\n\nNo table here.\n"),
    ("a wired hook left out", C5_CLEAN.replace("| `.claude/hooks/sample-guard.sh` | **Fires** on every Write and Edit | No, advisory |\n", "")),
    ("a wired hook that waits", C5_CLEAN.replace("**Fires** on every Write", "**Waits** for every Write")),
    ("a git hook marked not blocking", C5_CLEAN.replace("on every commit | Yes", "on every commit | No")),
]

# C9c. A workflow line that runs the content lint must start with ci_gate.sh,
# the one definition of how CI reads its exit code (3 warns and passes).
CI_GATE = "04_tools/ci_gate.sh"
CI_GATE_PREFIX = "bash %s " % CI_GATE
LINT_CALL_RE = re.compile(r"npm\b.*\brun\b.*\blint:(?:built|content)\b|cs_site_lint\.py")
YAML_RUN_PREFIX_RE = re.compile(r"^(?:-\s+)?(?:run:\s*)?")
# Seeded samples for the C9c matcher. House rule: every gate ships a
# self-test with a known-bad and a known-clean sample.
C9C_BAD = [
    "npm run -s lint:built",
    "npm --silent run lint:built",
    "echo 04_tools/ci_gate.sh; npm run lint:built",
    "python3 04_tools/cs_site_lint.py",
    "run: npm run lint:built",
]
C9C_CLEAN = [
    "bash 04_tools/ci_gate.sh npm run lint:built",
    "run: bash 04_tools/ci_gate.sh npm run lint:built",
    "python3 04_tools/cs_site_lint.py --self-test",
]

results = []


def record(name, status, detail=""):
    results.append((name, status, detail))
    label = {"OK": "OK  ", "FAIL": "FAIL", "SKIP": "SKIP", "INFRA": "INFRA"}[status]
    line = "  %s %s" % (label, name)
    if detail and status != "OK":
        line += ": " + detail
    print(line)


def check(name, ok, detail=""):
    record(name, "OK" if ok else "FAIL", detail)
    return ok


def path(rel):
    return os.path.join(REPO, rel)


def read(rel):
    with open(path(rel), encoding="utf-8") as fh:
        return fh.read()


def load_json(p):
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def import_lint():
    sys.path.insert(0, HERE)
    import cs_site_lint  # noqa: E402
    return cs_site_lint


# --------------------------------------------------------------------------


def c1_selftest():
    # The lint's self-test also fails a rule with no hit or no miss sample.
    try:
        proc = subprocess.run([sys.executable, os.path.join(HERE, "cs_site_lint.py"), "--self-test"],
                              capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as exc:
        record("C1 cs_site_lint.py --self-test passes", "INFRA", "could not run (%s)" % exc)
        return
    if proc.returncode == 0:
        record("C1 cs_site_lint.py --self-test passes", "OK")
    elif proc.returncode == EXIT_INFRA:
        record("C1 cs_site_lint.py --self-test passes", "INFRA",
               "self-test could not verify: %s" % proc.stdout.strip().splitlines()[-1:])
    else:
        bad = [l.strip() for l in proc.stdout.splitlines()
               if l.rstrip().endswith(": FAIL") or l.startswith("  ")]
        record("C1 cs_site_lint.py --self-test passes", "FAIL", "; ".join(bad[:8]))


def c2_parity(rules):
    shared = rules.get("shared_from") or {}
    li_path = os.path.expanduser(shared.get("path", ""))
    if not li_path or not os.path.isfile(li_path):
        record("C2 shared rules match the LinkedIn gate", "SKIP",
               "%s not present (expected in CI)" % (li_path or "shared_from.path"))
        return
    try:
        li = load_json(li_path)
    except (OSError, ValueError) as exc:
        record("C2 shared rules match the LinkedIn gate", "INFRA", "cannot read %s (%s)" % (li_path, exc))
        return
    ours = {r["id"]: r for r in rules["rules"]}
    theirs = {r["id"]: r for r in li.get("rules", [])}
    drift = []
    for rid in shared.get("ids", []):
        if rid not in theirs:
            drift.append("%s is not in the LinkedIn file" % rid)
            continue
        if rid not in ours:
            continue  # C10 reports it
        for field, default in PARITY_FIELDS:
            a, b = ours[rid].get(field, default), theirs[rid].get(field, default)
            if a != b:
                drift.append("%s.%s: site %r, LinkedIn %r" % (rid, field, a, b))
        # Windows: the LinkedIn file keeps them on the guardrail, the site on the rule.
        guard = {g["id"]: g for g in li.get("guardrails", [])}.get(theirs[rid].get("guardrail"), {})
        li_window = theirs[rid].get("window", guard.get("window"))
        if ours[rid].get("window") != li_window:
            drift.append("%s.window: site %r, LinkedIn %r" % (rid, ours[rid].get("window"), li_window))
    check("C2 shared rules match the LinkedIn gate (%d ids)" % len(shared.get("ids", [])),
          not drift, "; ".join(drift))


def c3_paths(rules, lint):
    franchise = next((r for r in rules["rules"] if r["id"] == "franchise-name"), None)
    got = franchise.get("paths") if franchise else None
    check("C3a franchise-name paths equal the pinned list", got == EXPECTED_FRANCHISE_PATHS,
          "rules file has %r, contract pins %r" % (got, EXPECTED_FRANCHISE_PATHS))

    scope = rules["scope"]["content"]
    never = rules["scope"].get("never", [])
    exts = sorted(set(os.path.splitext(g)[1] for g in scope if os.path.splitext(g)[1]))
    outside = []
    for rule in rules["rules"]:
        for glob in rule.get("paths", []):
            base = glob.replace("**/", "s/").replace("**", "s/sample").replace("*", "sample")
            cands = [base]
            if not os.path.splitext(base.rsplit("/", 1)[-1])[1]:
                cands += [base + e for e in exts] + [base + "/sample" + e for e in exts]
            hit = any(lint.glob_match(glob, c)
                      and any(lint.glob_match(s, c) for s in scope)
                      and not any(lint.glob_match(n, c) for n in never)
                      for c in cands)
            if not hit:
                outside.append("%s: %s" % (rule["id"], glob))
    check("C3b every rule path glob lands inside scope.content", not outside,
          "never reached by the lint: %s" % outside)


def c4_settings():
    rel = ".claude/settings.json"
    if not os.path.isfile(path(rel)):
        check("C4 settings deny every agent bypass", False, "%s is absent" % rel)
        return None
    try:
        settings = load_json(path(rel))
    except ValueError as exc:
        check("C4 settings deny every agent bypass", False, "%s is not valid JSON (%s)" % (rel, exc))
        return None
    deny = set((settings.get("permissions") or {}).get("deny", []))
    missing = [d for d in REQUIRED_DENY if d not in deny]
    check("C4 settings deny every agent bypass", not missing, "missing from deny: %s" % missing)
    return settings


def wired_hooks(settings):
    """[(hook_file_name, event, matcher)] from the settings file itself."""
    out = []
    for event, groups in (settings.get("hooks") or {}).items():
        for group in groups or []:
            matcher = group.get("matcher", "")
            for hook in group.get("hooks", []):
                for name in re.findall(r"\.claude/hooks/([A-Za-z0-9._-]+)", hook.get("command", "")):
                    out.append((name, event, matcher))
    return out


def gate_table(text):
    """Rows of the first markdown table headed Gate | When | Blocking."""
    rows = []
    in_table = False
    for line in text.splitlines():
        s = line.strip()
        if not s.startswith("|"):
            if in_table:
                break
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if not in_table:
            if [c.lower() for c in cells] == ["gate", "when", "blocking"]:
                in_table = True
            continue
        if all(set(c) <= set("-: ") for c in cells):
            continue
        rows.append(cells + [""] * (3 - len(cells)))
    return rows


def c5_problems(text, settings, githooks):
    """What is wrong with a gate table, as a list of strings.

    text is GATE_TABLE's file, or None when it is absent. settings is the
    parsed .claude/settings.json (or None) and githooks the file names in
    .githooks/. The real files and the C5 samples both go through this
    function.
    """
    if text is None:
        return ["%s is absent, so nothing names the wired gates" % GATE_TABLE]
    rows = gate_table(text)
    if not rows:
        return ["no table headed 'Gate | When | Blocking' in %s" % GATE_TABLE]
    expectations = []  # (name, words, blocking or None)
    for name, event, matcher in (wired_hooks(settings) if settings else []):
        words = [m for m in matcher.split("|") if m] if event in ("PreToolUse", "PostToolUse") \
            else EVENT_WORDS.get(event, [])
        expectations.append((name, words, EVENT_BLOCKS.get(event)))
    for name in githooks:
        words, blocking = GITHOOK_WORDS.get(name, ([], None))
        expectations.append((name, words, blocking))

    problems = []
    for name, words, blocking in expectations:
        matching = [r for r in rows if name in r[0]]
        if not matching:
            problems.append("%s is not named in the Gate column" % name)
            continue
        gate, when, blocks = matching[0][:3]
        low = when.lower()
        if not re.search(r"\bfires?\b", low) or re.search(r"\bwaits?\b", low):
            problems.append("%s: When says %r; a wired gate fires" % (name, when))
        for w in words:
            if w.lower() not in low:
                problems.append("%s: When should mention %r (got %r)" % (name, w, when))
        if blocking and not blocks.lower().lstrip("* ").startswith(blocking):
            problems.append("%s: Blocking should start with %r (got %r)" % (name, blocking.title(), blocks))
    return problems


def c5_selftest():
    wrong = ["missed known-bad %r" % label for label, text in C5_BAD
             if not c5_problems(text, C5_SETTINGS, C5_GITHOOKS)]
    clean = c5_problems(C5_CLEAN, C5_SETTINGS, C5_GITHOOKS)
    if clean:
        wrong.append("flagged known-clean: %s" % "; ".join(clean))
    check("C5 self-test: the table check flags every known-bad sample and passes the known-clean one",
          not wrong, "; ".join(wrong))


def c5_gate_table(settings):
    c5_selftest()
    text = read(GATE_TABLE) if os.path.isfile(path(GATE_TABLE)) else None
    githooks = path(".githooks")
    names = sorted(os.listdir(githooks)) if os.path.isdir(githooks) else []
    problems = c5_problems(text, settings, names)
    check("C5 gate table names every wired gate", not problems, "; ".join(problems))


def c6_severities(rules):
    bad = []
    for r in rules["rules"]:
        for field in ("severity", "severity_built", "after_expiry"):
            if field in r and r[field] not in ("FAIL", "WARN", "off"):
                bad.append("%s.%s=%r" % (r["id"], field, r[field]))
    vsev = rules["voice_lint"]["rules"].get("severity", {})
    for k, v in vsev.items():
        if v not in ("FAIL", "WARN", "off"):
            bad.append("voice_lint.%s=%r" % (k, v))
    check("C6a every severity is FAIL, WARN or off", not bad, ", ".join(bad))
    wrong = ["%s=%r (want %s)" % (k, vsev.get(k), v)
             for k, v in EXPECTED_VOICE_SEVERITY.items() if vsev.get(k) != v]
    check("C6b voice_lint grades: dashes FAIL, heuristics WARN", not wrong, ", ".join(wrong))


def c7_windows(rules):
    ours = {r["id"]: r for r in rules["rules"]}
    expected = dict(EXPECTED_WINDOWS)
    for rid, spec in (rules.get("private_windows") or {}).items():
        expected[rid] = (spec.get("window"), spec.get("after_expiry", "off"))
    wrong = []
    for rid, (window, after) in expected.items():
        r = ours.get(rid)
        if r is None:
            wrong.append("%s missing" % rid)
            continue
        if r.get("window") != window or r.get("after_expiry", "off") != after:
            wrong.append("%s: window %r after %r, want %r after %r"
                         % (rid, r.get("window"), r.get("after_expiry", "off"), window, after))
    check("C7 date windows match the decisions that set them (%d)" % len(expected), not wrong, "; ".join(wrong))


def c8_wiring(settings):
    if settings is None:
        check("C8 hook wiring", False, ".claude/settings.json unreadable")
        return
    wired = wired_hooks(settings)
    problems = []
    for name, event, _matcher in wired:
        rel = ".claude/hooks/" + name
        if not os.path.isfile(path(rel)):
            problems.append("%s is wired but absent" % rel)
            continue
        if not os.access(path(rel), os.X_OK):
            problems.append("%s is not executable" % rel)
        claims = re.findall(r"Wired in \.claude/settings\.json under ([A-Za-z]+)", read(rel))
        if not claims:
            problems.append("%s header does not say where it is wired" % rel)
        elif any(c != event for c in claims):
            problems.append("%s header claims %s; settings wire it under %s" % (rel, claims, event))
    hooks_dir = path(".claude/hooks")
    on_disk = set(n for n in os.listdir(hooks_dir) if n.endswith(".sh")) if os.path.isdir(hooks_dir) else set()
    unwired = sorted(on_disk - set(n for n, _, _ in wired))
    if unwired:
        problems.append("on disk but never fires: %s" % unwired)
    for name in ("pre-commit", "pre-push"):
        rel = ".githooks/" + name
        if not os.path.isfile(path(rel)):
            problems.append("%s is absent" % rel)
        elif not os.access(path(rel), os.X_OK):
            problems.append("%s is not executable, so git skips it" % rel)
    check("C8 hooks exist, are executable, and headers match settings", not problems, "; ".join(problems))


def bare_lint_call(line):
    """True when a workflow line runs the content lint without ci_gate.sh first.

    The real workflows and the C9C samples both go through this function.
    Comment lines are skipped. A --self-test call stays bare on purpose
    (04_tools/README.md, Exit contract). A leading YAML list dash or 'run:'
    key is dropped before the prefix test.
    """
    s = line.strip()
    if s.startswith("#") or "--self-test" in s or not LINT_CALL_RE.search(s):
        return False
    return not YAML_RUN_PREFIX_RE.sub("", s, count=1).startswith(CI_GATE_PREFIX)


def c9c_selftest():
    wrong = ["missed known-bad %r" % s for s in C9C_BAD if not bare_lint_call(s)]
    wrong += ["flagged known-clean %r" % s for s in C9C_CLEAN if bare_lint_call(s)]
    check("C9c self-test: the matcher flags every known-bad sample and passes every known-clean one",
          not wrong, "; ".join(wrong))


def c9_workflows():
    wf_dir = path(".github/workflows")
    if not os.path.isdir(wf_dir):
        check("C9 workflows call 04_tools and say they are advisory", False, ".github/workflows is absent")
        return
    inline, unlabeled, bare = [], [], []
    for name in sorted(os.listdir(wf_dir)):
        if not name.endswith((".yml", ".yaml")):
            continue
        body = read(".github/workflows/" + name)
        if re.search("grep[^\\n]*(\u2014|\u2013|em.dash|ironforge|coloradoai|crunchbase)", body, re.I):
            inline.append(name)
        header = "\n".join(l for l in body.splitlines()[:30] if l.lstrip().startswith("#"))
        # A ruleset can require a check (main: required checks, 2026-11-03),
        # so a header says either ADVISORY or REQUIRED: which one it is.
        if "ADVISORY" not in header and "REQUIRED" not in header:
            unlabeled.append(name)
        bare += ["%s:%d" % (name, no) for no, line in enumerate(body.splitlines(), 1)
                 if bare_lint_call(line)]
    check("C9a no workflow reimplements a check inline", not inline, "inline check logic in %s" % inline)
    check("C9b every workflow header says ADVISORY or REQUIRED", not unlabeled, "missing in %s" % unlabeled)
    c9c_selftest()
    if not os.path.isfile(path(CI_GATE)):
        bare.append("%s is absent" % CI_GATE)
    check("C9c every workflow lint call starts with '%s'" % CI_GATE_PREFIX.strip(), not bare,
          "lint call without the wrapper (exit 3 would turn the run red) at %s" % bare)


def import_tool(name):
    sys.path.insert(0, HERE)
    return __import__(name)


def tracked(*paths):
    """Tracked files, from the index, so untracked folders (worktrees) never count."""
    out = subprocess.run(["git", "-C", REPO, "ls-files", "-z", "--"] + list(paths), capture_output=True, timeout=60)
    if out.returncode != 0:
        raise OSError(out.stderr.decode()[:200])
    return [p for p in out.stdout.decode().split("\0") if p]


def disclosure_globs(text):
    """The path globs in a rule file's front matter: double-quoted, single-quoted or bare."""
    front = text.split("---")[1]
    items = re.findall(r"""^\s*-\s*(?:"([^"]+)"|'([^']+)'|([^\s"'#][^#]*?))\s*$""", front, re.M)
    return [a or b or c for a, b, c in items]


def covered(glob, maintainer):
    """A disclosure glob is maintainer-only verbatim, or under a broader folder glob."""
    return glob in maintainer or any(m.endswith("/**") and glob.startswith(m[:-2]) for m in maintainer)


def c12_problems(mp, policy, gates, globs):
    """(sample verdicts that are wrong, gate paths not maintainer-only, open disclosure surfaces)."""
    wrong = []
    for key, want in (("ai_mergeable", mp.EXIT_MERGEABLE), ("maintainer_only", mp.EXIT_WAITS),
                      ("default_deny", mp.EXIT_WAITS), ("refused", mp.EXIT_WAITS)):
        for paths in policy.get("samples", {}).get(key, []):
            if mp.verdict(policy, paths)[0] != want:
                wrong.append("%r should be %s" % (paths, key))
    loose = sorted(g for g in gates if not (mp.why_blocked(policy, g) or "").startswith("maintainer-only"))
    # A sample path inside each glob, made the way C3b makes them, and the glob itself.
    open_surfaces = [g for g in globs
                     if not covered(g, policy["maintainer_only"])
                     or not (mp.why_blocked(policy, g.replace("**/", "s/").replace("**", "s/sample")
                                            .replace("*", "sample")) or "").startswith("maintainer-only")]
    return wrong, loose, open_surfaces


def c13_problems(ex, mp, manifest, policy, paths):
    """(unlisted paths, clashes, pinned private paths made public, AI-mergeable private paths)."""
    exported, _private, unlisted, clashes = ex.plan(manifest, paths)
    leaked = [p for p in EXPORT_PRIVATE_PINNED if (ex.classify(manifest, p) or {}).get("public", True)]
    # An overlay file that replaces a private path exists in public as that file,
    # so the path counts as public here.
    both = [p for p in paths if mp.why_blocked(policy, p) is None and p not in exported
            and not (ex.classify(manifest, p) or {}).get("public")]
    return unlisted, clashes, leaked, both


def seeded(obj, how, glob):
    """A copy of the policy or manifest with one known-bad change."""
    o = json.loads(json.dumps(obj))
    if how in ("drop_maintainer", "move_to_ai"):
        o["maintainer_only"] = [g for g in o["maintainer_only"] if g != glob]
    if how in ("move_to_ai", "add_ai"):
        o["ai_mergeable"] = o["ai_mergeable"] + [glob]
    if how == "make_public":
        o["rules"] = [{"glob": glob, "public": True, "reason": "seeded bad sample"}] + o["rules"]
    return o


def c12_c13():
    try:
        mp, ex = import_tool("merge_policy"), import_tool("export_public")
        policy = mp.load_policy()
        globs = disclosure_globs(read(AI_DISCLOSURE_RULE))
        paths = tracked()
        gates = list(MAINTAINER_ONLY_PINNED)
        for d in MAINTAINER_ONLY_DIRS:
            found = tracked(d)
            if not found:
                raise OSError("no tracked files under %s, a gate folder" % d)
            gates += found
    except Exception as exc:  # the tools' InfraError, git missing, a missing gate folder or rule file
        record("C12 merge policy", "INFRA", "could not load (%s)" % exc)
        return
    try:
        manifest = ex.load_manifest()
    except ex.InfraError as exc:
        # A rule with a non-boolean public or a blank reason is refused here.
        check("C13 the export manifest loads", False, str(exc))
        return

    wrong, loose, open_surfaces = c12_problems(mp, policy, gates, globs)
    check("C12a the merge policy's samples give their verdicts", not wrong, "; ".join(wrong))
    check("C12b every gate file is maintainer-only by an explicit rule (%d paths)" % len(gates), not loose,
          "not pinned maintainer-only: %s" % loose[:8])
    check("C12c every AI disclosure surface is maintainer-only, verbatim or under a broader glob (%d globs)"
          % len(globs), globs and not open_surfaces, "open: %s" % open_surfaces)
    unlisted, clashes, leaked, both = c13_problems(ex, mp, manifest, policy, paths)
    check("C13a every tracked path is public or private (%d paths)" % len(paths), not unlisted and not clashes,
          "unlisted: %s; clashes: %s" % (unlisted[:8], clashes[:4]))
    check("C13b the plan's left-out paths stay private", not leaked, "public: %s" % leaked)
    check("C13c every AI-mergeable path is public", not both, "AI-mergeable but private: %s" % both[:8])

    missed = []
    for label, what, how, glob, probe in C12_BAD:
        bad = seeded(policy, how, glob)
        if not any(c12_problems(mp, bad, gates + [probe], globs)[1:]):
            missed.append(label)
    for label, what, how, glob, probe in C13_BAD:
        bad_manifest = seeded(manifest, how, glob) if what == "manifest" else manifest
        bad_policy = seeded(policy, how, glob) if what == "policy" else policy
        if not any(c13_problems(ex, mp, bad_manifest, bad_policy, paths + [probe])[2:]):
            missed.append(label)
    check("C12/C13 self-test: every known-bad policy and manifest is flagged (%d)" % (len(C12_BAD) + len(C13_BAD)),
          not missed, "missed: %s" % missed)


def c10_registry(rules):
    ids = set(r["id"] for r in rules["rules"])
    missing = [i for i in (rules.get("shared_from") or {}).get("ids", []) if i not in ids]
    check("C10a every shared id is a rule here", not missing, "missing: %s" % missing)
    bare = [n.get("id", "?") for n in rules.get("not_lintable", []) if not n.get("enforced_by")]
    check("C10b every not-lintable rule names who enforces it", not bare, "no enforced_by: %s" % bare)


def load_errors():
    """What loading can raise: the lint's InfraError once the lint imported."""
    lint = sys.modules.get("cs_site_lint")
    return (OSError, ValueError, ImportError, AttributeError) + ((lint.InfraError,) if lint else ())


def c11_private_split(rules, overlay_path):
    name = "C11 the private overlay is whole, and the public rules file names none of it"
    mark = rules.get("private_marker")
    if overlay_path is None:
        if mark:
            check(name, False, "%s requires the private overlay, and it is missing" % mark["_path"])
        else:
            record(name, "SKIP", "no private overlay and no marker (expected in the public repo)")
        return
    if not mark:
        check(name, False, "the overlay %s has no %s beside it" % (overlay_path, MARKER_NAME))
        return
    overlay = load_json(overlay_path)
    short = import_lint().overlay_shortfall(overlay, mark)
    public = read(os.path.relpath(RULES, REPO))
    leaked = []
    for r in overlay.get("rules", []):
        texts = ['"%s"' % r["id"], json.dumps(r["regex"])[1:-1]] + list((r.get("samples") or {}).get("hit", []))
        leaked += ["%s: %r" % (r["id"], t) for t in texts if t.lower() in public.lower()]
        rx = re.compile(r["regex"], 0 if r.get("case_sensitive") else re.I)
        leaked += ["%s matches %r" % (r["id"], m.group(0)) for m in rx.finditer(public)]
    check(name + " (%d private rules)" % len(overlay.get("rules", [])), not short and not leaked,
          "; ".join(["overlay holds " + x for x in short] + leaked[:8]))

def main():
    print("coloradostartups-site contract test")
    try:
        lint = import_lint()
        # enforce=False: a missing or short overlay is C11's FAIL, which the
        # commit hook blocks on, not a load error (exit 3), which it lets pass.
        rules, overlay_path = lint.load_rules_data(RULES, enforce=False)
    except load_errors() as exc:
        print("INFRA: could not load the rules or the lint (%s)" % exc, file=sys.stderr)
        print("INFRA: could not verify, which is not the same as verified and red.", file=sys.stderr)
        return EXIT_INFRA
    try:
        c1_selftest()
        c2_parity(rules)
        c3_paths(rules, lint)
        settings = c4_settings()
        c5_gate_table(settings)
        c6_severities(rules)
        c7_windows(rules)
        c8_wiring(settings)
        c9_workflows()
        c12_c13()
        c10_registry(rules)
        c11_private_split(rules, overlay_path)
    except (KeyError, TypeError, AttributeError) as exc:
        print("INFRA: rules file shape is not what the contract test expects (%s: %s)"
              % (type(exc).__name__, exc), file=sys.stderr)
        return EXIT_INFRA

    failed = [n for n, s, _ in results if s == "FAIL"]
    infra = [n for n, s, _ in results if s == "INFRA"]
    skipped = [n for n, s, _ in results if s == "SKIP"]
    print()
    if failed:
        print("contract test: FAIL (%d of %d)" % (len(failed), len(results)))
        for n in failed:
            print("  broken: %s" % n)
        return EXIT_FAIL
    if infra:
        print("contract test: could not verify %s" % infra)
        return EXIT_INFRA
    print("contract test: PASS (%d contracts, %d skipped)" % (len(results), len(skipped)))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
