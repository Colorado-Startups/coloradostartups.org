// One lookup for every illustration under src/assets/art. Keys are paths
// without an extension, such as "textures/stone". Pictures come from brand
// releases instead (brandArt, below).
// A missing file returns undefined, so a component shows its placeholder for
// any art that has not landed yet.
import type { ImageMetadata } from "astro";

import SIZES from "../../../public/art/brand/sizes.json";

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
 * into site/public/art/brand/, checks its sha256, writes webp sizes that keep the
 * file's metadata, and records each picture in sizes.json. The AI-made label and
 * photo credit live in that metadata (brand decision 46), and Astro's image
 * pipeline would strip them, so these files are served as-is.
 * Key: "brand/<name>", e.g. "brand/golden" or "brand/communitas-small".
 */
interface BrandSize {
  file: string;
  width: number;
  height: number;
  widths: number[];
}

const BRAND_SIZES: Readonly<Record<string, BrandSize>> = SIZES;
export const BRAND_NAMES: readonly string[] = Object.keys(BRAND_SIZES);

export interface BrandArt {
  src: string;
  srcset: string;
  width: number;
  height: number;
}

export function brandArt(key: string): BrandArt | undefined {
  const name = key.startsWith("brand/") ? key.slice("brand/".length) : "";
  const size = Object.hasOwn(BRAND_SIZES, name) ? BRAND_SIZES[name] : undefined;
  if (!size) return undefined;
  const url = (w: number) => `/art/brand/${name}-${w}.webp`;
  return {
    src: url(size.widths.at(-1)!),
    srcset: size.widths.map((w) => `${url(w)} ${w}w`).join(", "),
    width: size.width,
    height: size.height,
  };
}
