// The county or counties each suggested HQ city sits in, so the nomination
// form can fill in the county from the city (#147). Pure data: the page
// script imports it, so it must not import zod or the parser.
//
// Source: U.S. Census Bureau, 2020 Census place-by-county file for Colorado,
// st08_co_place_by_county2020.txt, at
// https://www2.census.gov/geo/docs/reference/codes2020/place_by_cou/st08_co_place_by_county2020.txt
// (read 2026-11-02). The Bureau publishes no 2020 place-to-county
// relationship file; this code list is its place-and-county pairing, with
// one line per place and county. Typed by hand from that file's lines for
// these cities, not generated. A city in more than one county lists each
// here, and the form asks which one.
//
// Keys are the city names the site already uses: every Colorado HQ city in
// places.ts and every core or nearby city in data/regions/. "Cascade" is the
// Census place "Cascade-Chipita Park CDP". test/unit/forms/place-counties.test.ts
// fails when one of those cities has no entry here.

export const PLACE_COUNTIES: Readonly<Record<string, readonly string[]>> = {
  Arvada: ["Adams", "Jefferson"],
  Aspen: ["Pitkin"],
  Aurora: ["Adams", "Arapahoe", "Douglas"],
  Berthoud: ["Larimer", "Weld"],
  Boulder: ["Boulder"],
  Breckenridge: ["Summit"],
  Broomfield: ["Broomfield"],
  "Buena Vista": ["Chaffee"],
  Carbondale: ["Garfield"],
  Cascade: ["El Paso"],
  "Castle Rock": ["Douglas"],
  Centennial: ["Arapahoe"],
  "Colorado Springs": ["El Paso"],
  "Copper Mountain": ["Summit"],
  "Crested Butte": ["Gunnison"],
  Denver: ["Denver"],
  Durango: ["La Plata"],
  Edwards: ["Eagle"],
  Englewood: ["Arapahoe"],
  Erie: ["Boulder", "Weld"],
  "Estes Park": ["Larimer"],
  Evans: ["Weld"],
  Evergreen: ["Jefferson"],
  "Fort Collins": ["Larimer"],
  Fountain: ["El Paso"],
  Frederick: ["Weld"],
  "Glenwood Springs": ["Garfield"],
  Golden: ["Jefferson"],
  "Grand Junction": ["Mesa"],
  Greeley: ["Weld"],
  "Greenwood Village": ["Arapahoe"],
  "Highlands Ranch": ["Douglas"],
  Johnstown: ["Larimer", "Weld"],
  "La Junta": ["Otero"],
  Lafayette: ["Boulder"],
  Lakewood: ["Jefferson"],
  Littleton: ["Arapahoe", "Douglas", "Jefferson"],
  "Lone Tree": ["Douglas"],
  Longmont: ["Boulder", "Weld"],
  Louisville: ["Boulder"],
  Loveland: ["Larimer"],
  Lyons: ["Boulder"],
  "Manitou Springs": ["El Paso"],
  Monument: ["El Paso"],
  Nederland: ["Boulder"],
  Niwot: ["Boulder"],
  "Pagosa Springs": ["Archuleta"],
  Parker: ["Douglas"],
  Pueblo: ["Pueblo"],
  Salida: ["Chaffee"],
  Silverthorne: ["Summit"],
  "Steamboat Springs": ["Routt"],
  Superior: ["Boulder", "Jefferson"],
  Thornton: ["Adams", "Weld"],
  Timnath: ["Larimer", "Weld"],
  Vail: ["Eagle"],
  Wellington: ["Larimer"],
  Westminster: ["Adams", "Jefferson"],
  "Wheat Ridge": ["Jefferson"],
  Windsor: ["Larimer", "Weld"],
  "Woodland Park": ["Teller"],
};

function cityKey(city: string): string {
  return city.trim().replace(/\s+/g, " ").toLowerCase();
}

const BY_KEY = new Map(Object.keys(PLACE_COUNTIES).map((city) => [cityKey(city), city]));

/** The listed spelling of a city, matched without case; undefined for a city not listed. */
export function listedCity(city: string): string | undefined {
  return BY_KEY.get(cityKey(city));
}

/** The counties a city sits in, matched without case; [] for a city not listed. */
export function countiesForCity(city: string): readonly string[] {
  const listed = listedCity(city);
  return listed ? PLACE_COUNTIES[listed]! : [];
}
