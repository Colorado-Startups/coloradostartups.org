// Build-time image lookups for the Team page.
//
// Keeper portraits are not here: KeeperCard uses L7's Portrait, which finds
// src/assets/art/agents/<id>.(webp|png|jpg) through the one art lookup in
// src/components/art/art-assets.ts (lane/L7-wiring).
//
// People photos: a person's `photo` field is a file name in ./photos/ without
// the extension, e.g. "paul-foley". The four photos there come from CS's own
// public Team page (coloradostartups.org/the-team), saved by L6's Squarespace
// backup script and resized to 640 px.
import type { ImageMetadata } from "astro";

const PHOTOS = import.meta.glob<{ default: ImageMetadata }>("./photos/*.{webp,png,jpg}", { eager: true });

/** Each photo by its file name without the extension, e.g. "paul-foley". */
const photos = new Map(
  Object.entries(PHOTOS).map(([file, mod]) => [file.slice(file.lastIndexOf("/") + 1).replace(/\.[^.]+$/, ""), mod.default]),
);

export function personPhoto(photo: string | undefined): ImageMetadata | undefined {
  return photo ? photos.get(photo) : undefined;
}
