// Credits for the brand v3 place paintings on the site, from the brand's own
// record (Colorado-Startups/brand data/world.yaml place_art and dist/README.md,
// at the tag in brand.lock.json). Each painting is AI-made with FIBO 2.0 from a
// real photo; the photo's credit and the AI-made label also ride in the file's
// metadata (brand decision 46). /credits/ renders this list.
export const BRAND_CREDITS_URL = "https://github.com/Colorado-Startups/brand/blob/main/dist/README.md";

export interface PlaceCredit {
  town: string;
  region: string;
  credit: string;
}

export const PLACE_CREDITS: Record<"boulder" | "golden" | "denver" | "springs" | "fortcollins", PlaceCredit> = {
  boulder: { town: "Boulder", region: "Photon Mountain", credit: "Public-domain photo by Jimbo Herndan" },
  golden: { town: "Golden", region: "Photon Mountain", credit: "Photo by James St. John, CC BY 2.0, edited" },
  denver: { town: "Denver", region: "Photon Mountain", credit: "Public-domain photo by USFWS Mountain-Prairie" },
  springs: { town: "Colorado Springs", region: "Space Peak", credit: "Photo by Huttarl, CC BY 2.5, edited" },
  fortcollins: { town: "Fort Collins", region: "Fusion Canyon", credit: "Photo by Charles Willgren, CC BY 2.0, edited" },
};
