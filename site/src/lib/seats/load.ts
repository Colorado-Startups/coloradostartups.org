// The volunteer seat pages' data (lane L38), read from data/positions/.
// scripts/positions/sync-volunteers.mjs copies those files from the volunteer
// kit when someone runs it, never in a build; nothing here reads the kit.
// Local zod schemas parse every file, so a bad sync stops the build instead
// of shipping a broken page.
// data/team/positions.yaml stays the source for /get-involved/ and the form;
// site/test/unit/l38/ checks that the two agree.
import { COURSE_IDS, REGION_IDS, type CourseId } from "@cs/shared";
import { parse } from "yaml";
import { z } from "zod";

import { cityKey, REGIONS } from "../regions/match";

const files = import.meta.glob<string>("../../../../data/positions/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

const SHARED_FILES = ["common", "facts", "geo"] as const;

const text = z.string().trim().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const https = z.url({ protocol: /^https$/ });
const courseId = z.enum(COURSE_IDS);

const FactSchema = z
  .object({
    value: text,
    label: text,
    source: text,
    url: https,
    read: day,
    short: text,
    bar: text.optional(),
  })
  .strict();
export type Fact = z.infer<typeof FactSchema>;

const SeatSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: text,
    kind: z.enum(["community", "region"]),
    region: text.optional(),
    eyebrow: text,
    where: text,
    one_liner: text,
    do: z.array(text).min(1),
    bring: z.array(text).min(1),
    rules_extra: z.array(text),
    extra_courses: z.array(courseId),
  })
  .strict();
export type Seat = z.infer<typeof SeatSchema>;

const CommonSchema = z
  .object({
    org: z.object({ name: text, tagline: text, lead: text }).strict(),
    apply: z.object({ email: z.email(), subject_prefix: text, form_url: https }).strict(),
    courses: z.record(courseId, z.object({ title: text, url: https, length: text }).strict()),
    core_courses: z.array(courseId).min(1),
    perks: z.array(text).min(1),
    steps: z.array(z.object({ title: text, body: text }).strict()).length(3),
    look_for: z.array(text).min(1),
    rules_common: z.array(text).min(1),
    linkedin_rule: text,
    course_lengths_read: day,
  })
  .strict();
export type Common = z.infer<typeof CommonSchema>;

const point = { name: text, lat: z.number(), lon: z.number() };
const GeoSchema = z
  .object({
    state_bounds: z.object({ north: z.number(), south: z.number(), west: z.number(), east: z.number() }).strict(),
    cities: z
      .array(z.object({ ...point, region: z.enum(REGION_IDS), core: z.boolean(), gnis_id: z.number().optional() }).strict())
      .min(1),
    peaks: z.array(z.object({ ...point, gnis_id: z.number().optional() }).strict()),
    landmarks: z.array(z.object({ ...point, region: z.enum(REGION_IDS).optional() }).strict()),
  })
  .strict();
type GeoFile = z.infer<typeof GeoSchema>;
/** A map city: `core` comes from data/regions/, `hub` is the kit's own core flag (see loadGeo). */
export type GeoCity = GeoFile["cities"][number] & { hub: boolean };
export type Geo = Omit<GeoFile, "cities"> & { cities: GeoCity[] };

function file(name: string): unknown {
  const raw = files[`../../../../data/positions/${name}.yaml`];
  if (raw === undefined) throw new Error(`data/positions/${name}.yaml is missing; run scripts/positions/sync-volunteers.mjs`);
  return parse(raw);
}

function parsed<T>(name: string, schema: z.ZodType<T>): T {
  const result = schema.safeParse(file(name));
  if (!result.success) throw new Error(`data/positions/${name}.yaml: ${z.prettifyError(result.error)}`);
  return result.data;
}

/** Every seat file in data/positions/, by id, in file-name order. */
export function loadSeats(): Seat[] {
  const names = Object.keys(files)
    .map((key) => key.replace(/^.*\/([^/]+)\.yaml$/, "$1"))
    .filter((name) => !(SHARED_FILES as readonly string[]).includes(name))
    .sort();
  return names.map((name) => {
    const seat = parsed(name, SeatSchema);
    if (seat.id !== name) throw new Error(`data/positions/${name}.yaml holds seat "${seat.id}"`);
    return seat;
  });
}

/** What every seat shares. zod's enum-keyed record requires every course in COURSE_IDS. */
export function loadCommon(): Common {
  return parsed("common", CommonSchema);
}

/** The facts a seat page may show: the sync kept only those marked R and not gated. */
export function loadFacts(): Readonly<Record<string, Fact>> {
  return parsed("facts", z.record(z.string(), FactSchema));
}

/**
 * The seat maps' coordinates. A city is core when its region's file in
 * data/regions/ lists it under `cities`, the core cities Paul named (decision
 * 45). The kit's geo.json calls a narrower set core: Boulder, Golden, Denver,
 * Fort Collins and Colorado Springs, without Arvada, Loveland, Windsor and
 * Greeley (#180). Its flag comes through as `hub`, the cities the small
 * statewide map labels.
 */
export function loadGeo(): Geo {
  const geo = parsed("geo", GeoSchema);
  const core = new Set(REGIONS.flatMap((r) => r.cities.map(cityKey)));
  return { ...geo, cities: geo.cities.map((c) => ({ ...c, core: core.has(cityKey(c.name)), hub: c.core })) };
}

/** One fact by id. A missing id stops the build, so a page can never show a gated or unsynced figure. */
export function factById(facts: Readonly<Record<string, Fact>>, id: string): Fact {
  const found = facts[id];
  if (!found) throw new Error(`fact "${id}" is not in data/positions/facts.yaml (gated, S-marked or not synced)`);
  return found;
}

/** A course's length in hours: "2.5 hours" is 2.5, "45 minutes" is 0.75. */
export function parseHours(length: string): number {
  const m = /^\s*([\d.]+)\s*(hours?|minutes?)\b/.exec(length);
  if (!m) throw new Error(`course length not understood: "${length}"`);
  const n = Number(m[1]);
  return m[2]!.startsWith("hour") ? n : n / 60;
}

export interface SeatCourse {
  id: CourseId;
  title: string;
  url: string;
  length: string;
  hours: number;
}

/** The courses a seat needs, core courses first, each with its length in hours. */
export function seatCourses(seat: Pick<Seat, "extra_courses">, common: Common): SeatCourse[] {
  return [...common.core_courses, ...seat.extra_courses].map((id) => {
    const course = common.courses[id]!;
    return { id, ...course, hours: parseHours(course.length) };
  });
}
