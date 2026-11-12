# LTX-2.5: the verdict

*Part of [`LICENSES.md`](../LICENSES.md). Read 2026-11-02; sources: [`sources.md`](sources.md). A record for Paul, not legal advice.*

| LTX-2.5 (`Lightricks/LTX-2.5`) and its IC-LoRAs. | Answer | Source |
| --- | --- | --- |
| Verdict | **Allowed** for motion and video edits, with the [duties](duties.md). Outputs allowed. | LTX-2.x Community License (2026-08-11); LTX Acceptable Use Policy (2026-03-30). |
| Commercial use | Free, commercial use included, for an entity under $10M annual revenue (source: §2.1). Comfy Cloud's hosting is covered. | Rows 6, 7 |
| Attribution | No credit line on outputs. Copyright notices apply only if we hand on LTX files, and we hand on none. Label and provenance: the duties. | §3.4, §6, Attachment A items 5 and 19. |
| Output ownership | Lightricks claims no rights in Output. | §5 |
| IC-LoRAs | The same license; each card names it. | IC-LoRA cards on Hugging Face. |

| Route | Allowed | Price | Run tier |
| --- | --- | --- | --- |
| Comfy Cloud open-weight templates `video_ltx2_5_i2v`, `video_ltx2_5_flf2v`, `video_ltx2_5_t2v`, `video_ltx2_5_dfr_i2v`. **Cheapest compliant option** | Yes (rows 6, 7) | Standard plan credits, spent on active GPU time (source: comfy.org/pricing). No source gives a per-second or per-clip figure, so the first approved run measures it; `estimate_credits` finds no paid node. | 2 |
| IC-LoRAs on Comfy Cloud: `refine-details-1.0`, `alpha-gen-0.9`, `restore-1.0`, `layout-to-render-1.0` (source: `search_models`). | Yes | GPU time, as above | 2 |
| Comfy Cloud LTX-2.5 paid nodes. | Yes | Fast 27.16 credits a second of 720p; Pro 36.21 at 720p, 51.29 at 1080p (source: Comfy Partner Node pricing). A 5-second 720p Fast clip: about 136 credits, $0.64 (computed here, per the rate). | 3; not needed |
| This Mac | n/a | n/a | Never: no local video (`~/.claude/rules/compute.md`, Comfy). |

## The reasoning, rows 6 to 8

| # | Question | What the text says | Reading for Colorado Startups, Ltd. | Verdict |
| --- | --- | --- | --- | --- |
| 6 | Is CS under LTX's revenue line? | §2.1: royalty-free for any purpose below $10M a year, per §2.1; above it, a paid Commercial Use Agreement. The line counts affiliates under common Control (§1.6): owning over 50%, per §1.3, or the power to run the company. | The repo records no revenue figure. A fiscal sponsor that neither owns nor runs the company is not under common Control. | **Allowed** once Paul confirms revenue under the line. |
| 7 | Can Comfy Cloud run LTX-2.5 for us? | §3 lets a host offer LTX-2.x as a service if it passes the license terms on. | Comfy hosts; our use stays under the Community License (§2.1). The verdict rests on the license, not on Comfy's provider table. | **Allowed** |
| 8 | Do real places need clearance? | The AUP: commercial content must not replicate a real-world likeness, person, brand or location unless independently cleared. | Landforms such as the Flatirons and Pikes Peak are stylized. Built places carry no shop names (no text in images) and no brands; no real people appear. 17 U.S.C. §120(a) allows pictures of buildings visible from public places. | **Cleared** here; the orchestrator confirms. |
