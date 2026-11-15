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

/**
 * Brand v3 art: scripts/brand/pull.mjs pulls each file named in brand.lock.json
 * into site/public/art/brand/, checks its sha256, and writes 720w and 1440w webp
 * copies that keep the file's metadata. The AI-made label and photo credit live
 * there (brand decision 46), and Astro's image pipeline would strip them, so
 * these files are served as-is. Key: "brand/<name>", e.g. "brand/golden".
 */
export const BRAND_NAMES = ["boulder", "golden", "denver", "springs", "fortcollins"] as const;
export type BrandName = (typeof BRAND_NAMES)[number];

export interface BrandArt {
  src: string;
  srcset: string;
  width: number;
  height: number;
}

export function brandArt(key: string): BrandArt | undefined {
  const name = key.startsWith("brand/") ? key.slice("brand/".length) : "";
  if (!(BRAND_NAMES as readonly string[]).includes(name)) return undefined;
  const base = `/art/brand/${name}`;
  // Every brand place painting is 1440 x 720 (brand art/direction, place images).
  return { src: `${base}-1440.webp`, srcset: `${base}-720.webp 720w, ${base}-1440.webp 1440w`, width: 1440, height: 720 };
}
