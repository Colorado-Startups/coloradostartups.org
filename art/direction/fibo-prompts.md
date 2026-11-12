# Art direction: FIBO 2.0 prompts

*Part of [`DIRECTION.md`](../DIRECTION.md), art direction v3; [`LICENSES.md`](../LICENSES.md) says which route is allowed.*

## FIBO 2.0 prompts: the Hall in VGL

| Prompt rule | Source |
| --- | --- |
| One JSON caption, a field per concern. The Bria node takes it in `structured_prompt`, or writes and returns one from a plain `prompt` | [VGL caption guide](https://huggingface.co/briaai/Fibo-2.0-dev/blob/main/vgl/README.md), read 2026-11-02. |
| Copy the fixed words below, from `style.txt` and the palette, so new stills match the shipped art. Braces change per image. | |
| At most 5 `objects` and 3 words of `artistic_style` | The VGL guide |
| No hex codes. Neither Anima nor FIBO 2.0 reads hex, so the style line and `color_scheme` carry the palette in words. | For FIBO 2.0: the VGL guide. |
| Leave out `text_render`, so banners and pages stay blank. | |
| No field takes Anima's quality prefix or score tags. | |
| Only the edit node takes a `negative_prompt`: describe what is there. | "Describe, don't instruct", the guide's rule. |

```json
{
  "short_description": "{the scene in one or two sentences}",
  "objects": [
    {
      "description": "{a founder or a keeper}",
      "location": "{where in the frame}",
      "relationship": "{how it relates to the others}"
    }
  ],
  "background_setting": "{the Hall, and the Colorado view through it}",
  "lighting": {
    "conditions": "luminous golden light from glowing lanterns and warm forge fire",
    "direction": "{where the warm key light comes from}",
    "shadows": "soft, warm bronze shadows"
  },
  "aesthetics": {
    "composition": "{the shot, and where the calm space for type sits}",
    "color_scheme": "warm cream, honey gold, ember orange, copper and bronze, with one clear note of Colorado blue sky",
    "mood_atmosphere": "bright, glowing, cheerful and welcoming"
  },
  "style_medium": "stylized hand-painted high-fantasy illustration with bold chunky shapes, thick confident outlines, visible painted brush texture and soft cel shading",
  "context": "{what the image is for, such as a home-page hero}",
  "artistic_style": "stylized, painterly, bold"
}
```

