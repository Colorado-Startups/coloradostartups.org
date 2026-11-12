// Per-photo crops for the Team page (#256). Owner: L9.
//
// The four photos in ./photos/ are square, and PersonCard shows each in a
// square ring, so object-position alone cannot move a face in its frame. A
// crop names the square part of the photo to show instead, and PersonCard
// zooms the photo to it with CSS. The photo files stay as they are.
//
// Keys are photo file names without the extension, as in images.ts. A photo
// with no entry shows whole.

export interface PhotoCrop {
  /** Left edge of the crop, as a fraction of the photo's width. */
  x: number;
  /** Top edge of the crop, as a fraction of the photo's height. */
  y: number;
  /** Side of the square crop, as a fraction of the photo's side. */
  size: number;
}

export const PHOTO_CROPS: Readonly<Record<string, PhotoCrop>> = {
  // A seated full-length shot. This square keeps head and shoulders, as the
  // other three photos show.
  "lindsey-rohde": { x: 0.27, y: 0, size: 0.55 },
};

const pct = (n: number) => `${Number((n * 100).toFixed(2))}%`;

/** How far PersonCard zooms a photo to fill its frame with the crop: 1 when it shows whole. */
export function photoCropZoom(photo: string | undefined): number {
  const crop = photo ? PHOTO_CROPS[photo] : undefined;
  return crop ? 1 / crop.size : 1;
}

/**
 * The custom properties PersonCard reads to zoom a photo to its crop, as an
 * inline style, or undefined when the photo shows whole.
 */
export function photoCropStyle(photo: string | undefined): string | undefined {
  const crop = photo ? PHOTO_CROPS[photo] : undefined;
  if (!crop) return undefined;
  return `--photo-zoom: ${Number(photoCropZoom(photo).toFixed(4))}; --photo-x: ${pct(-crop.x)}; --photo-y: ${pct(-crop.y)}`;
}

/**
 * The file widths to build for a photo. A zoomed photo shows only its crop,
 * so each width grows by the zoom, up to the source's own width. The crop then
 * gets as many source pixels as a whole photo does at the same `sizes`.
 */
export function photoWidths(photo: string | undefined, base: readonly number[], sourceWidth: number): number[] {
  const zoom = photoCropZoom(photo);
  return [...new Set(base.map((w) => Math.min(Math.round(w * zoom), sourceWidth)))];
}
