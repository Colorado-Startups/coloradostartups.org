"""Self-test, part two: exit codes, the private overlay, and the runner.

cs_site_lint.py --self-test calls self_test() here.
"""

import json
import os
import shutil
import sys
import tempfile

import cs_site_lint_rules as rules
from cs_site_lint import (
    DEFAULT_MARKER, EXIT_FAIL, EXIT_INFRA, EXIT_OK, EXIT_USAGE, PRIVATE_RULES_ENV, InfraError,
    lint_text_as, load_config, load_voice_lint, main,
)
from cs_site_lint_samples import (
    SAMPLE_BAD_JSON, SAMPLE_BAD_TXT, SAMPLE_CLEAN_TXT, SAMPLE_DEEP_JSON, SELF_TEST_TODAY,
    self_test_built_files, self_test_samples, self_test_source_files, self_test_windows, write_sample,
)


def self_test_exit_codes(tmp, rules_path, check):
    """Exit codes, through main(), on the dispatches self_test_source_files wrote."""
    def main_rc(args):
        # The rules file under test, so a scope change shows up here too.
        if rules_path and "--rules" not in args:
            args = ["--rules", rules_path] + args
        saved = sys.stdout
        sys.stdout = open(os.devnull, "w")
        try:
            return main(args)
        finally:
            sys.stdout.close()
            sys.stdout = saved

    clean_path = os.path.join(tmp, "data/dispatches/clean.md")
    bad_path = os.path.join(tmp, "data/dispatches/bad.md")
    check(main_rc(["--root", tmp, "--quiet", clean_path]) == EXIT_OK, "exit 0 on a clean file")
    check(main_rc(["--root", tmp, "--quiet", clean_path, bad_path]) == EXIT_FAIL,
          "exit 1 when any file FAILs")
    check(main_rc(["--root", tmp, "--quiet", os.path.join(tmp, "docs/brand.md")]) == EXIT_OK,
          "exit 0 when every file is out of scope")

    # --built over whole directories, one per type, so each type must be
    # read for its directory to FAIL. A clean dist passes, and a type
    # scope.built does not name (.xml) is never read.
    write_sample(tmp, "bad-txt/dist/llms.txt", SAMPLE_BAD_TXT)
    write_sample(tmp, "bad-json/dist/feed.json", SAMPLE_BAD_JSON)
    for kind in ("txt", "json"):
        rc = main_rc(["--root", tmp, "--quiet", "--built", os.path.join(tmp, "bad-%s/dist" % kind)])
        check(rc == EXIT_FAIL, "--built reads .%s files and exits 1 on the bad sample" % kind)
    write_sample(tmp, "clean/dist/index.html", "<html><body><p>Founders meet in Denver.</p></body></html>\n")
    write_sample(tmp, "clean/dist/robots.txt", SAMPLE_CLEAN_TXT)
    write_sample(tmp, "clean/dist/data/resources.json", '[{"id":"maybe-later","name":"Founder Legal Clinic"}]')
    write_sample(tmp, "clean/dist/sitemap-0.xml", "<urlset>Ironforge — hall</urlset>\n")
    check(main_rc(["--root", tmp, "--quiet", "--built", os.path.join(tmp, "clean/dist")]) == EXIT_OK,
          "--built exits 0 on a clean dist, and skips types scope.built does not name")

    # A bracket slot WARNs in a draft and FAILs once it is built (#808).
    slot = "Welcome to [@mention up to 10 newest members].\n"
    slot_md = write_sample(tmp, "data/dispatches/slot.md", "# Welcome\n\n" + slot)
    write_sample(tmp, "slot/dist/index.html", "<html><body><p>%s</p></body></html>\n" % slot.strip())
    check(main_rc(["--root", tmp, "--quiet", slot_md]) == EXIT_OK, "a placeholder in a source file WARNs: exit 0")
    check(main_rc(["--root", tmp, "--quiet", "--built", os.path.join(tmp, "slot/dist")]) == EXIT_FAIL,
          "a placeholder on a built page FAILs: exit 1 (#808)")
    write_sample(tmp, "broken/dist/feed.json", "{not json")
    write_sample(tmp, "deep/dist/feed.json", SAMPLE_DEEP_JSON)
    write_sample(tmp, "mixed/dist/feed.json", "{not json")
    write_sample(tmp, "mixed/dist/llms.txt", SAMPLE_BAD_TXT)

    old_err = sys.stderr
    sys.stderr = open(os.devnull, "w")
    try:
        rc_rules = main_rc(["--root", tmp, "--rules", os.path.join(tmp, "missing.json"), clean_path])
        rc_built = main_rc(["--root", tmp, "--built", os.path.join(tmp, "no-such-dist")])
        rc_broken = main_rc(["--root", tmp, "--built", os.path.join(tmp, "broken/dist")])
        try:
            rc_deep = main_rc(["--root", tmp, "--built", os.path.join(tmp, "deep/dist")])
        except RecursionError:
            rc_deep = "RecursionError"
        rc_mixed = main_rc(["--root", tmp, "--built", os.path.join(tmp, "mixed/dist")])
        rc_usage = main_rc(["--today", "not-a-date", clean_path])
    finally:
        sys.stderr.close()
        sys.stderr = old_err
    check(rc_rules == EXIT_INFRA, "exit 3 when the rules file is missing")
    check(rc_built == EXIT_INFRA, "exit 3 when the built directory is missing")
    check(rc_broken == EXIT_INFRA, "exit 3 when a built .json file does not parse")
    check(rc_deep == EXIT_INFRA,
          "exit 3 when the only built file is .json nested 5,000 levels deep (got %r)" % rc_deep)
    check(rc_mixed == EXIT_FAIL, "exit 1 when a real FAIL sits next to a .json file that does not parse")
    check(rc_usage == EXIT_USAGE, "exit 2 on a bad --today")


def self_test_overlay(rules_path, vl, tmp, check):
    """The private overlay: a sample rule fires with it and not without, and
    the required-overlay marker turns a missing or short overlay into exit 3
    (#624)."""
    d = os.path.join(tmp, "overlay")
    overlay, missing = os.path.join(d, "private.json"), os.path.join(d, "missing.json")
    marker, no_marker = os.path.join(d, "marker"), os.path.join(d, "no-marker")
    empty = os.path.join(d, "empty.json")
    dupes, unique, required = os.path.join(d, "dupes.json"), os.path.join(d, "unique.json"), os.path.join(d, "required")
    os.makedirs(d, exist_ok=True)
    with open(empty, "w", encoding="utf-8") as fh:
        json.dump({"rules": [], "shared_ids": []}, fh)
    rule = {"id": "selftest-private", "severity": "FAIL", "regex": "\\bzorblax\\b", "message": "sample",
            "source": "self-test", "samples": {"hit": ["zorblax"], "miss": ["zorb"]}}
    with open(dupes, "w", encoding="utf-8") as fh:
        json.dump({"rules": [rule, dict(rule)], "shared_ids": ["selftest-private", "selftest-private"]}, fh)
    with open(unique, "w", encoding="utf-8") as fh:
        json.dump({"rules": [rule, dict(rule, id="selftest-other")], "shared_ids": ["selftest-private"]}, fh)
    with open(required, "w", encoding="utf-8") as fh:
        json.dump({"min_rules": 2, "min_shared_ids": 1, "required_ids": ["selftest-private", "selftest-gone"],
                   "expected_windows": {}}, fh)
    with open(overlay, "w", encoding="utf-8") as fh:
        json.dump({"shared_ids": [], "rules": [{"id": "selftest-private", "severity": "FAIL", "regex": "\\bzorblax\\b",
                                                "message": "sample private term", "source": "self-test",
                                                "samples": {"hit": ["zorblax"], "miss": ["zorb"]}}]}, fh)
    with open(marker, "w", encoding="utf-8") as fh:
        json.dump({"min_rules": 2, "min_shared_ids": 1, "expected_windows": {}}, fh)
    text = "# Notes\n\nWe met the Zorblax founders.\n"

    def fires(cfg):
        got = lint_text_as(cfg, vl, "data/dispatches/p.md", text, SELF_TEST_TODAY) or []
        return any(f[2] == "selftest-private" for f in got)

    with_it = load_config(rules_path, env={PRIVATE_RULES_ENV: overlay}, marker=no_marker)
    check(with_it.private_path == overlay and fires(with_it), "a rule in the overlay CS_SITE_PRIVATE_RULES names fires")
    without = load_config(rules_path, env={}, default_private=missing, marker=no_marker)
    check(without.private_path is None and not fires(without), "with no overlay and no marker the same text passes")
    for label, env, default, mark in (
        ("the marker with the overlay missing", {}, missing, marker),
        ("the marker with an overlay short of its minimums", {}, overlay, marker),
        ("an empty overlay, even with no marker", {PRIVATE_RULES_ENV: empty}, None, no_marker),
        ("copies of one rule standing in for the minimum", {}, dupes, marker),
        ("a required id missing", {}, unique, required),
        ("an empty CS_SITE_PRIVATE_RULES", {PRIVATE_RULES_ENV: ""}, None, no_marker),
        ("a directory at the overlay path", {}, d, no_marker),
    ):
        try:
            load_config(rules_path, env=env, default_private=default, marker=mark)
            check(False, "%s is could-not-check" % label)
        except InfraError:
            check(True, "%s is could-not-check" % label)
    # Through main(), as the hooks, CI and the content guard call it, with no
    # setup: this repo's real marker, and the overlay gone.
    saved_default, saved_named = rules.DEFAULT_PRIVATE_RULES, os.environ.pop(PRIVATE_RULES_ENV, None)
    saved_out, saved_err = sys.stdout, sys.stderr
    rules.DEFAULT_PRIVATE_RULES = missing
    sys.stdout = sys.stderr = open(os.devnull, "w")
    try:
        rc = main((["--rules", rules_path] if rules_path else []) + ["--root", tmp, "--quiet", overlay])
    finally:
        sys.stdout.close()
        sys.stdout, sys.stderr = saved_out, saved_err
        rules.DEFAULT_PRIVATE_RULES = saved_default
        if saved_named is not None:
            os.environ[PRIVATE_RULES_ENV] = saved_named
    if os.path.exists(DEFAULT_MARKER):
        check(rc == EXIT_INFRA, "this repo's marker with the overlay missing exits 3 (got %r)" % rc)
    else:
        check(rc == EXIT_OK, "no marker (the public repo): a missing overlay is a note, exit 0 (got %r)" % rc)


def self_test(rules_path=None):
    ok = [True]

    def check(cond, label):
        print("self-test: %s: %s" % (label, "OK" if cond else "FAIL"))
        if not cond:
            ok[0] = False
        return cond

    try:
        cfg = load_config(rules_path)
    except InfraError as exc:
        print("self-test: could not verify: %s" % exc)
        return EXIT_INFRA
    check(True, "rules file loads and every regex compiles (%d rules)" % len(cfg.rules))
    print("self-test: private overlay: %s" % (os.path.basename(cfg.private_path) if cfg.private_path else "absent, public rules only"))
    vl, problem = load_voice_lint(cfg)
    if vl is None:
        print("self-test: could not verify: %s" % problem)
        return EXIT_INFRA
    check(True, "voice_lint loads with the severity overrides")

    self_test_samples(cfg, check)
    self_test_windows(cfg, check)
    tmp = tempfile.mkdtemp(prefix="cs-site-selftest-")
    try:
        self_test_source_files(cfg, vl, tmp, check)
        self_test_built_files(cfg, vl, tmp, rules_path, check)
        self_test_exit_codes(tmp, rules_path, check)
        self_test_overlay(rules_path, vl, tmp, check)
    finally:
        shutil.rmtree(tmp)

    print("self-test:", "PASS" if ok[0] else "FAIL")
    return EXIT_OK if ok[0] else EXIT_FAIL
