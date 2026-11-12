# 04_tools: content and git gates

*The house rules, then `cs_site_rules.json`, win over this file. Which gate fires: [`site-gates.md`](../.claude/rules/site-gates.md) (C5, C8). Each script's header has its options.*

## Checkers

| Checker | Run | Exits | Guards |
| --- | --- | --- | --- |
| [`cs_site_lint.py`](cs_site_lint.py) | `python3 04_tools/cs_site_lint.py [FILE...]`, `--built site/dist` | contract | Site words and dates; the one definition every call site runs |
| [`voice_lint.py`](voice_lint.py) | `python3 04_tools/voice_lint.py FILE` | contract | Prose; vendored verbatim from `SoulCraft-Org/git-crafter` `tools/voice_lint.py` (its first lines name the commit), never edited here |
| [`contract_test.py`](contract_test.py) | `python3 04_tools/contract_test.py` | contract | Rules, settings, hooks, workflows and gate table agree |
| [`hook_selftest.sh`](hook_selftest.sh) | `bash 04_tools/hook_selftest.sh` | contract | Hooks block a bad file and a push to `main`; pre-push runs no `npm` |
| [`ci_gate.sh`](ci_gate.sh) | `bash 04_tools/ci_gate.sh npm run lint:built` | 3 becomes a warning | Runs one checker in CI; routes, never decides |
| [`ci_runner.sh`](ci_runner.sh) | `CI_RUNNER` in `site-tests.yml`, `e2e.yml` | contract; 1 for arm, larger or self-hosted | The `runs-on` label |
| [`secret_scan.sh`](secret_scan.sh) | `secret-scan.yml` | 0, 1, 2; 4 broken scanner, never 3 | Pinned gitleaks over a run's commits; never in `ci_gate.sh` |
| [`deploy_gate.sh`](deploy_gate.sh), vendored from Git Crafter | `deploy-gate.yml` | 0 moved or waiting; 1 refused; 2; 3 red | Fast-forwards `production` after `site-tests` and `secret-scan` pass; an outside commit soaks first |
| [`merge_policy.py`](merge_policy.py) (vendored from Git Crafter), [`.json`](merge_policy.json), [`fixtures`](merge_policy_fixtures/) | `--pr N --sha <head>` | 0 mergeable; 1 not; 2; 3 | Outside PRs, on since 2026-11-12. Every path `ai_mergeable`, none `maintainer_only` |
| [`export_public.py`](export_public.py), [`export_manifest.json`](export_manifest.json) | `--check`, `--out DIR`, `--self-test` | 0; 1 unlisted or clash; 2; 3 | The public repo (#552): every path matches a rule with a reason |
| [`export_scan.py`](export_scan.py) | `export-dry-run.yml`, with gitleaks | 0, 1, 3 | Emails, phones, names, keys and private links in an exported tree |
| [`package_age.py`](package_age.py) | `dependency-age.yml` | contract | New lockfile versions come from npm, 14 days old (7 for a fix; decisions 12, 89) |
| [`gitleaks_allow.py`](gitleaks_allow.py), [`.json`](gitleaks_allow.json) | `secret-scan.yml`: the tree and `--range BASE..HEAD`; `--self-test` | contract | gitleaks' inline allow marker only on the lines the list names, in the tree and on every line a run's commits add (#774); the base commit's copy judges a PR |

## Rules data

| File | Holds |
| --- | --- |
| [`cs_site_rules.json`](cs_site_rules.json) | Scope, grades, term rules with samples, date windows, rules shared with LinkedIn |
| [`cs_site_rules.private.json`](cs_site_rules.private.json) | The private avoid list (20 term rules), never exported (#552); `CS_SITE_PRIVATE_RULES` names another path. Without it, 10 public rules run and C11 skips |
| [`.private-overlay-required`](.private-overlay-required) | Marks the archive (#624, #667): the overlay must load with its minimums and `required_ids`. Missing: lint 3, C11 FAIL |

## Exit contract

| Code | Means | Hooks | CI |
| --- | --- | --- | --- |
| 0 | Nothing blocks; warnings allowed | Pass | Pass |
| 1 | A FAIL | Block; the content guard shows Claude | Red |
| 2 | Usage error | Pass, with a note | Red: the workflow calls it wrong |
| 3 | Could not check | Pass, with a note | `ci_gate.sh` warns and passes |

Could not verify is not verified, so 2 and 3 never block a commit.

## Changing a rule

1. Edit `cs_site_rules.json`, or the private file. A new rule gets `hit` and `miss` samples.
2. A shared rule (`shared_from.ids`): change LinkedIn's file too, or C2 fails.
3. A private rule added or removed: update `.private-overlay-required`, or C11 fails.
4. Run `contract_test.py`.

Known limit (#667): deleting the overlay and its marker together looks like a public clone. Only review catches it: both are `maintainer_only`, and CODEOWNERS covers `04_tools/`. A check would be one more file to delete with them.
