# AI-visibility panel

- [x] Built 2026-10-18 by lane L27 for the go-live checklist's item C12 (private archive): at T+7, then monthly (its Verification section).
- [ ] Baseline run: it spends money, so it waits for Paul's yes in chat, then the orchestrator runs it.

| Item | Fact |
| --- | --- |
| Goal (Paul's) | ChatGPT, Claude, Perplexity and other assistants name Colorado Startups first when asked about startups in Colorado |
| Baseline | Planned at cutover, so the change after launch shows against the old site. Cutover came 2026-10-18 (decision 73) with no run |
| Scope | Live AI search, web search on; not training data ([Known limits](PROVIDERS.md#known-limits)) |
| Request | The question alone: no system prompt, no user location, so all three answer the same words |

*Method, questions and measures: [`METHOD.md`](METHOD.md). Providers, spend gate, decisions and limits: [`PROVIDERS.md`](PROVIDERS.md).*

<a id="what-it-asks"></a><a id="what-is-measured"></a><a id="who-it-asks"></a><a id="spend-gate-and-cost"></a><a id="decisions-in-this-lane"></a><a id="known-limits"></a>

## Spend

| Rule | Detail |
| --- | --- |
| Estimate | For the full panel the runner estimates $7.30, across three accounts. `test/questions.test.ts` fails if this row and `pricing.yaml` disagree |

## Results

<!-- results:start -->
No live run yet. The baseline goes here after the orchestrator runs it.
<!-- results:end -->

## Running it

| Run | `npm run eval:ai-visibility --` plus |
| --- | --- |
| Dry run: no network, keys or cost | nothing |
| Live baseline, after Paul's yes, three keys set | `--live --confirm-spend --write-report` |
| Smoke test first: about 1/20 of the estimate, proves each key and endpoint | `--live --confirm-spend --questions v01 --date 2026-10-18-smoke` |
| Cheaper: one provider, a few questions | `--live --confirm-spend --providers anthropic --questions v01,v03` |
| Re-score after a scorer change, no API calls | `--rescore evals/ai-visibility/results/<date>-<provider>.json` |
| Tests, offline, on `test/fixtures/` | CI `site-tests` (root `check:push`) and root `npm test` run `test:ai-visibility`. On demand: `gh workflow run cloud-test.yml --ref <branch> -f script=test:ai-visibility` |
| Type check | `npx tsc -p evals/ai-visibility/tsconfig.json` |
| Exit codes, the repo's checker contract | 0 done, 2 usage error or refused, 3 could not check |

