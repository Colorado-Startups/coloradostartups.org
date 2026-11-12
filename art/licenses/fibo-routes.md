# FIBO 2.0: which route works today

*Part of [`LICENSES.md`](../LICENSES.md). Each route's reasoning row: [`fibo-reasoning.md`](fibo-reasoning.md). Read 2026-11-02.*

| Credits to dollars | Source |
| --- | --- |
| 211 credits a dollar (computed here). | `comfy cloud status` shows 4,082 credits for $19.35 (source: the CLI). |
| The same rate, per Comfy's table: 736.39 credits for $3.49. | Comfy's price table for deployed workflows (source: comfy.org/pricing, "Comfy API pricing"). |

| Route | For the site | Usable today | Price | Run tier |
| --- | --- | --- | --- | --- |
| **Bria nodes** on Comfy Cloud: `api_bria_fibo2_t2i`, `api_bria_image_edit`; Bria's hosted FIBO 2.0 through Comfy's agreement with Bria (row 4). | Pending Comfy's written confirmation. Recommended for stills and edits. | Test runs, with Paul's yes. Nothing ships until Comfy confirms in writing. | 12.07 credits a run (source: Comfy Partner Node pricing), about $0.057 (computed here). | 3 |
| **Bria API, pay as you go**: Bria's Terms of Use plus the plan's terms (row 5a). | Only if the checkout terms grant commercial rights to pay-as-you-go use. | After Paul reads the checkout terms, then adds a card and an API key. Nothing here calls the Bria API. | $0.032 an image for "Fibo" and "Fibo Edit" (source: bria.ai/pricing); the list names no version. | 3 |
| **Bria FIBO 2 Free, self-hosted**: Bria's build, generation and editing, on servers we run; its license shows in full only at checkout. | Yes, under $2M revenue (source: Bria's plans page). | **No.** This Mac cannot run it (below); a rented GPU is tier 4 work. | $0 a month for 2,000 calls, then $0.04 a call (source: Bria's plans page), plus the GPU. | 4 |
| **Bria FIBO 2 Starter, self-hosted**: one production workload. | Yes, under $10M revenue; Scale also under $10M, Enterprise any size (source: Bria's plans page). | No, the same reason | $499 a month for 25,000 calls (source: Bria's plans page), plus the GPU; credit line not stated. | 4 |
| **Bria FIBO 2 Turbo, self-hosted** (row 10). | No license on sale (Bria's plans page, 2026-11-02). | No | n/a | n/a |
| **Bria API free trial** (row 5): personal and non-commercial use only. | No | n/a | 100 free generations (source: bria.ai/pricing). | n/a |
| **Open weights**: `briaai/Fibo-2.0-dev`, `briaai/Fibo-2.0-edit-turbo`, `Comfy-Org/Fibo-2.0`; Comfy Cloud's `image_fibo2_edit_dev_pe`, `image_fibo2_edit_turbo_pe` (rows 1 to 3, 9). CC BY-NC 4.0 plus Bria's gate terms. | Not allowed as published, at any revenue. Access needs a company name and intended use. | n/a | n/a; §3(a) applies only when sharing the weights. | n/a |

*No credit line on any route that states one.*

| Why FIBO 2 Free cannot run on this Mac. | Source |
| --- | --- |
| No model runs on this Mac since 2026-11-02. | `~/.claude/rules/compute.md` |
| Its disk had 6.3 GB free. | `diskutil info /`, 2026-11-02. |
| The bf16 files total 25.7 GB (computed here), more than the Mac's 24 GB of memory. | Hugging Face file sizes |
| The plans page does not say whether a rented cloud GPU counts as "your own servers". | The license text at checkout settles it. |
