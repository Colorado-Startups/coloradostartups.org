// One lookup for every illustration under src/assets/art. Keys are paths
// without an extension, such as "hero/hall" or "agents/resourcus-small".
// A missing file returns undefined, so a component shows its placeholder for
// any art that has not landed yet.
import type { ImageMetadata } from "astro";

const files = import.meta.glob<{ default: ImageMetadata }>("../../assets/art/**/*.{webp,png,jpg}", {
  eager: true,
});

const EXTENSIONS = ["webp", "png", "jpg"] as const;

export function findArt(key: string): ImageMetadata | undefined {
  for (const ext of EXTENSIONS) {
    const hit = files[`../../assets/art/${key}.${ext}`];
    if (hit) return hit.default;
  }
  return undefined;
}

/**
 * Keep only the srcset widths the source can fill, so Astro never upscales.
 * When a wider width is dropped, the source width takes its place, so a 2x
 * screen still gets every pixel the art has (#205).
 */
export function fitWidths(widths: readonly number[], sourceWidth: number): number[] {
  const fitted = widths.filter((w) => w <= sourceWidth);
  const needsSource = fitted.length < widths.length || fitted.length === 0;
  if (needsSource && !fitted.includes(sourceWidth)) fitted.push(sourceWidth);
  return fitted;
}
