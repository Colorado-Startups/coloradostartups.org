# Concepts: texture tiles

*Part of the [v3 concepts record](README.md): batch 1 and batch 2 on Modal, 2026-10-18. Previews sit in `batch-<n>/` here.*

| Render (for L12's tiles) | Batch | `make-tiles.mjs` verdict (source: make-tiles, 2026-10-18) | Look | Decision |
| --- | --- | --- | --- | --- |
| [`tile-night-stone`](batch-1/tile-night-stone.webp) | 1 | ok: 34 KB, seam 0.92. | Fine, light granite speckle that maps to a calm dark band. | **Ships** as `textures/night-stone.webp` |
| [`tile-stone`](batch-1/tile-stone.webp) | 1 | FAIL: wrap edge 2.40x rougher than the interior. | Asked for smooth carved sandstone. Got a peach lighting gradient with a few brush dashes; mapped, it reads as birch bark. | Re-render |
| [`tile-parchment`](batch-1/tile-parchment.webp) | 1 | ok: 13 KB, seam 0.39. | Asked for warm handmade paper. Got a near-flat cream gradient with horizontal banding and no fibers, as L14 noted. | Re-render |
| [`tile-stone-1`](batch-2/tile-stone-1.webp) | 2 | ok: 75 KB, seam 1.06. | A large diagonal wave that repeats visibly at 512 px. | |
| [`tile-stone-2`](batch-2/tile-stone-2.webp) | 2 | ok: 74 KB, seam 1.04. | Fine, even pitted grain. Calm, but close to stucco. | |
| [`tile-stone-3`](batch-2/tile-stone-3.webp) | 2 | ok: 63 KB, seam 1.04, 78% at or above `stone` (75% is the goal) | Soft sandstone mottling with fine grain. Calm, no visible repeat. | **Ships** as `textures/stone.webp` |
| [`tile-parchment-1`](batch-2/tile-parchment-1.webp) | 2 | FAIL: 74 KB, over the 60 KB goal. | | |
| [`tile-parchment-2`](batch-2/tile-parchment-2.webp) | 2 | ok: 54 KB, seam 1.06. | A one-way diagonal hatch, closer to twill cloth than paper. | |
| [`tile-parchment-3`](batch-2/tile-parchment-3.webp) | 2 | ok: 49 KB, seam 1.03. | Soft flecks with no direction, like handmade paper. | **Ships** as `textures/parchment.webp` |

| Step | What |
| --- | --- |
| Rule (orchestrator) | Re-render any tile that fails its check or lacks the look in [DIRECTION's tile settings](../DIRECTION.md#settings-edits-and-upscales) |
| Batch 1 cause | Both failures lit the surface with a top-to-bottom gradient and left little fine texture. |
| Batch 2 fix | `tile-stone-v2.txt` and `tile-parchment-v2.txt` ask for an even all-over pattern, "like a sample swatch", and add gradient, light falloff and banding to the negative prompt. |
| Result | All six v2 renders carry real texture. Every seam measured 1.03 to 1.06 against the 1.5 limit (source: make-tiles) |
| Picks (L17, under the rule) | Both pass their checks and match DIRECTION's look. `art/finals.json` records them, and `make-finals.mjs` builds them with make-tiles' method. |

