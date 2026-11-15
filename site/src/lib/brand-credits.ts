// Credits for the brand pictures on the site. The place paintings come first,
// from the brand's own record (Colorado-Startups/brand data/world.yaml
// place_art and dist/README.md, at the tag in brand.lock.json). Each painting is AI-made with FIBO 2.0 from a
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

/**
 * The brand's website art, also on the site (brand dist/website/ and dist/logo/
 * README, at the tag in brand.lock.json, read 2026-11-15). None starts from a
 * photo, so none owes a photo credit. Each keeper row says it is an AI agent
 * (.claude/rules/ai-disclosure.md). `names` are the pulled file names.
 */
export interface WebsiteArtCredit {
  names: readonly string[];
  picture: string;
  made: string;
}

const TEXT_TO_IMAGE = "AI-made with FIBO 2.0, text to image. No source photo.";
const SHIELD_EDIT = "AI-made with FIBO 2.0, an edit of the 2014 Colorado Startups shield.";

export const WEBSITE_ART_CREDITS: readonly WebsiteArtCredit[] = [
  { names: ["communitas", "communitas-small"], picture: "Communitas, an AI agent, painted as a dwarf with a lantern on a pole.", made: TEXT_TO_IMAGE },
  { names: ["resourcus", "resourcus-small"], picture: "Resourcus, an AI agent, painted as a gnome mapkeeper.", made: TEXT_TO_IMAGE },
  { names: ["publicus", "publicus-small"], picture: "Publicus, an AI agent, painted as a dwarf herald.", made: TEXT_TO_IMAGE },
  { names: ["passage"], picture: "The 404 scene: a cog railway in a pink-granite passage ends at a blank wall.", made: TEXT_TO_IMAGE },
  { names: ["founders"], picture: "Founders build a glowing fusion core in a red sandstone workshop.", made: TEXT_TO_IMAGE },
  { names: ["guides"], picture: "Two founders plan a route on a picture map, in a study above Denver and the Front Range.", made: TEXT_TO_IMAGE },
  { names: ["stone"], picture: "A warm sandstone tile. The page backgrounds' three texture tiles are made from it.", made: TEXT_TO_IMAGE },
  { names: ["emblem-512"], picture: "The crest: the shield as a winged crest in royal-blue enamel and gold.", made: SHIELD_EDIT },
  { names: ["favicon", "apple-touch-icon", "icon-192", "icon-512"], picture: "The site icon: a white shield on State blue.", made: SHIELD_EDIT },
];
