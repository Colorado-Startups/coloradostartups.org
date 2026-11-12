// Turns the calendar feed into the dated occurrences /event-calendar/ lists:
// recurring series expanded, EXDATEs removed, single-instance overrides
// (RECURRENCE-ID) swapped in, cancelled and private events left out. Also
// decides each event's link and whether it happens at a street address.

import {
  civilInZone,
  first,
  offsetText,
  parseCalendar,
  parseDateList,
  parseDateValue,
  parseDuration,
  parseRrule,
  expandRrule,
  textOf,
  zonedToUtc,
} from "./ics.mjs";

const DAY = 86_400_000;

// --------------------------------------------------------------------------
// Text

/**
 * Display text for a title or location: whitespace collapsed, and em dashes
 * and spaced en dashes (which the house rules ban, and the built-HTML gate
 * fails) turned into commas.
 */
export function cleanText(text) {
  return String(text ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s+–\s+/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "");
}

const URL_ONLY = /^(?:https?:\/\/|www\.)\S+$/i;
const VIRTUAL = /\b(?:virtual(?:ly)?|online|zoom|webinar|livestream(?:ed)?|live\s+stream|google\s+meet|(?:ms|microsoft)\s+teams)\b/i;
const IN_PERSON = /\bin[\s-]?person\b|\bhybrid\b/i;
// A ZIP code, or ", CO" / ", Colorado" after a place: enough to give Google
// a postal address rather than a venue nickname.
const ADDRESS = /\b\d{5}(?:-\d{4})?\b|,\s*(?:CO|Colorado)\b/;

/**
 * True when people can attend at a street address we can name. A location
 * that is only a link, names no address, or says virtual without saying in
 * person is not.
 */
export function isInPerson(location) {
  if (!location || URL_ONLY.test(location)) return false;
  if (VIRTUAL.test(location) && !IN_PERSON.test(location)) return false;
  return ADDRESS.test(location);
}

// --------------------------------------------------------------------------
// Links

const EVENT_HOSTS = ["lu.ma", "luma.com", "eventbrite.com", "meetup.com", "partiful.com"];
// Join links, maps and the calendar itself are not event pages.
const NOT_EVENT_PAGES = [
  "meet.google.com",
  "zoom.us",
  "teams.microsoft.com",
  "teams.live.com",
  "maps.google.com",
  "maps.app.goo.gl",
  "goo.gl",
  "calendar.google.com",
];

const onHost = (host, list) => list.some((h) => host === h || host.endsWith(`.${h}`));

/** An http(s) URL, unwrapped from Google's redirect, or null. */
export function cleanUrl(raw) {
  const url = urlOf(raw);
  if (!url) return null;
  if (/^(?:www\.)?google\.com$/.test(url.hostname) && url.pathname === "/url") return redirectTarget(url);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  const out = url.toString();
  return out.length <= 500 ? out : null;
}

/** The text as a URL, trailing punctuation trimmed and a bare www. given https; null when it does not parse. */
function urlOf(raw) {
  let text = String(raw).replace(/&amp;/g, "&").replace(/[).,;:!?'"\]]+$/, "");
  if (/^www\./i.test(text)) text = `https://${text}`;
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/** Google's /url?q= redirect: its http(s) target, cleaned, or null. */
function redirectTarget(url) {
  const target = url.searchParams.get("q");
  return target && /^https?:\/\//i.test(target) ? cleanUrl(target) : null;
}

/** Every http(s) link in a block of text or HTML, in order. */
function findLinks(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(/(?:https?:\/\/|\bwww\.)[^\s"'<>]+/gi)) {
    const url = cleanUrl(m[0]);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

/**
 * The event's page: its URL property, else a Luma, Eventbrite, Meetup or
 * Partiful link from the description, else the first other link that is not
 * a join link or a map, else a location that is only a link.
 */
export function pickUrl({ urlProp, description, location }) {
  const candidates = [urlProp, ...findLinks(description), URL_ONLY.test(location ?? "") ? location : null]
    .map((u) => (u ? cleanUrl(u) : null))
    .filter(Boolean);
  if (urlProp && candidates[0] === cleanUrl(urlProp)) return candidates[0];
  const hostOf = (u) => new URL(u).hostname.toLowerCase();
  const isPage = (u) => !onHost(hostOf(u), NOT_EVENT_PAGES) && !/^\/maps\b/.test(new URL(u).pathname);
  return candidates.find((u) => onHost(hostOf(u), EVENT_HOSTS)) ?? candidates.find(isPage) ?? null;
}

// --------------------------------------------------------------------------
// Occurrences

const uidOf = (ev) => first(ev, "UID")?.value.trim() || "";

/**
 * The source fields of one VEVENT (a series or a single-instance override),
 * shaped for the content gate and the snapshot.
 */
function sourceFields(ev) {
  const rawLocation = cleanText(textOf(ev, "LOCATION"));
  const description = textOf(ev, "DESCRIPTION");
  const urlProp = first(ev, "URL")?.value.trim() || null;
  const url = pickUrl({ urlProp, description, location: rawLocation });
  const location = rawLocation && !URL_ONLY.test(rawLocation) ? rawLocation : null;
  return {
    uid: uidOf(ev),
    title: cleanText(textOf(ev, "SUMMARY")),
    location,
    url,
    description,
    inPerson: isInPerson(location),
  };
}

const isHidden = (ev) =>
  /^CANCELLED$/i.test(first(ev, "STATUS")?.value.trim() ?? "") ||
  /^(?:PRIVATE|CONFIDENTIAL)$/i.test(first(ev, "CLASS")?.value.trim() ?? "");

/** Snapshot date text: "2026-10-21T17:30:00-06:00", or "2026-10-21" for a date. */
function isoInZone(utcMs, tz) {
  const civil = new Date(civilInZone(utcMs, tz)).toISOString().slice(0, 19);
  return `${civil}${offsetText(utcMs, tz)}`;
}
const isoDate = (civilMs) => new Date(civilMs).toISOString().slice(0, 10);

// The steps below share one context per read of the feed: the window
// (fromMs, toMs), the calendar's own timeZone, the horizonCivil recurrence
// stops at, and the sources, occurrences and notes the read collects.

function addSource(ctx, ev) {
  ctx.sources.push({ ...sourceFields(ev), recurring: Boolean(first(ev, "RRULE")) });
  return ctx.sources.length - 1;
}

/** Adds one occurrence of a source when it overlaps the window. */
function emit(ctx, sourceIndex, start, durationMs) {
  const { timeZone } = ctx;
  const startUtc = start.allDay ? zonedToUtc(start.civil, timeZone) : start.utc;
  const endUtc = start.allDay ? zonedToUtc(start.civil + durationMs, timeZone) : start.utc + durationMs;
  if (endUtc <= ctx.fromMs || startUtc >= ctx.toMs) return;
  ctx.occurrences.push({
    sourceIndex,
    startUtc,
    endUtc,
    allDay: start.allDay,
    start: start.allDay ? isoDate(start.civil) : isoInZone(startUtc, timeZone),
    // An all-day event's end is its last day, inclusive.
    end: start.allDay ? isoDate(start.civil + durationMs - DAY) : isoInZone(endUtc, timeZone),
  });
}

function durationOf(ctx, ev, start, uid) {
  const dtend = first(ev, "DTEND");
  if (dtend) {
    const ms = endDuration(ctx, dtend, start);
    if (ms !== null) return ms;
    ctx.notes.push({ uid, reason: "DTEND before DTSTART; treated as no end" });
  }
  const dur = first(ev, "DURATION");
  const ms = dur ? parseDuration(dur.value) : null;
  if (ms !== null && ms >= 0) return ms;
  return start.allDay ? DAY : 0;
}

/** The length DTEND gives; null when DTEND is unreadable or before the start. A zero-length all-day event lasts its day. */
function endDuration(ctx, dtend, start) {
  const end = parseDateValue(dtend.value, dtend.params, ctx.timeZone);
  if (!end) return null;
  const ms = start.allDay ? end.civil - start.civil : end.utc - start.utc;
  if (ms > 0) return ms;
  if (ms === 0) return start.allDay ? DAY : 0;
  return null;
}

function startOf(ctx, ev, uid) {
  const dt = first(ev, "DTSTART");
  const start = dt ? parseDateValue(dt.value, dt.params, ctx.timeZone) : null;
  if (!start) ctx.notes.push({ uid, reason: "missing or unreadable DTSTART" });
  else if (start.unknownZone) ctx.notes.push({ uid, reason: `unknown TZID ${start.unknownZone}; read as ${ctx.timeZone}` });
  return start;
}

/**
 * Splits the events into series and single-instance overrides. Overrides go
 * by UID, keyed by the instant of the instance they replace.
 */
function collectOverrides(ctx, events) {
  const overrides = new Map();
  const masters = [];
  for (const ev of events) {
    const rid = first(ev, "RECURRENCE-ID");
    const uid = uidOf(ev);
    if (rid && uid) {
      const at = parseDateValue(rid.value, rid.params, ctx.timeZone);
      if (!at) {
        ctx.notes.push({ uid, reason: `unreadable RECURRENCE-ID ${rid.value}` });
        continue;
      }
      if (!overrides.has(uid)) overrides.set(uid, new Map());
      overrides.get(uid).set(at.allDay ? isoDate(at.civil) : at.utc, ev);
    } else {
      masters.push(ev);
    }
  }
  return { masters, overrides };
}

/**
 * The instances of a recurring series: each date its RRULE gives, minus the
 * EXDATEs and the dates an override in `own` stands in for. Null, with a
 * note, when the rule cannot be expanded.
 */
function expandSeries(ctx, ev, start, own) {
  const uid = uidOf(ev);
  const rule = parseRrule(first(ev, "RRULE").value);
  if (rule.unsupported.length) {
    ctx.notes.push({ uid, reason: `recurrence not expanded (${rule.unsupported.join(", ")}); left to the embed` });
    return null;
  }
  const untilUtc = untilUtcOf(ctx, rule, start, uid);
  if (untilUtc === null) return null;
  const tz = start.allDay ? ctx.timeZone : start.tz;
  const toUtc = (civil) => zonedToUtc(civil, tz);
  let civils;
  try {
    civils = expandRrule(rule, { startCivil: start.civil, horizonCivil: ctx.horizonCivil, untilUtc, toUtc });
  } catch (err) {
    ctx.notes.push({ uid, reason: `recurrence not expanded (${err.message}); left to the embed` });
    return null;
  }
  return keptInstances(civils, { ev, start, own, tz, toUtc });
}

/** The series' end as an instant: undefined with no UNTIL; null, with a note, when UNTIL is unreadable. */
function untilUtcOf(ctx, rule, start, uid) {
  if (!rule.until) return undefined;
  const until = parseDateValue(rule.until, {}, start.tz);
  if (!until) {
    ctx.notes.push({ uid, reason: `unreadable UNTIL ${rule.until}` });
    return null;
  }
  // A date-only UNTIL includes that whole day.
  return until.allDay ? zonedToUtc(until.civil + DAY - 1, start.tz) : until.utc;
}

/** The expanded dates less the EXDATEs and the dates an override in `own` stands in for. */
function keptInstances(civils, { ev, start, own, tz, toUtc }) {
  const exdates = parseDateList(ev.EXDATE, start.tz);
  const exUtc = new Set(exdates.filter((d) => !d.allDay).map((d) => d.utc));
  const exDays = new Set(exdates.filter((d) => d.allDay).map((d) => isoDate(d.civil)));
  const instances = [];
  for (const civil of civils) {
    const day = isoDate(civil);
    const utc = start.allDay ? civil : toUtc(civil);
    if (exUtc.has(utc) || exDays.has(day)) continue;
    if (own.has(start.allDay ? day : utc)) continue; // the override stands in for it
    instances.push({ civil, tz, allDay: start.allDay, utc });
  }
  return instances;
}

/** Emits a series, or a single event, under one source. */
function emitSeries(ctx, ev, own) {
  const uid = uidOf(ev);
  const start = startOf(ctx, ev, uid);
  if (!start) return;
  const duration = durationOf(ctx, ev, start, uid);
  const instances = first(ev, "RRULE") ? expandSeries(ctx, ev, start, own) : [start];
  if (!instances?.length || isHidden(ev)) return;
  const sourceIndex = addSource(ctx, ev);
  for (const at of instances) emit(ctx, sourceIndex, at, duration);
}

/** Emits each override, at its own (possibly moved) time, as its own source. */
function emitOverrides(ctx, overrides, masterUids) {
  for (const [uid, byKey] of overrides) {
    if (!masterUids.has(uid)) ctx.notes.push({ uid, reason: "override without its series; listed on its own" });
    for (const ev of byKey.values()) {
      if (isHidden(ev)) continue;
      const start = startOf(ctx, ev, uid);
      if (!start) continue;
      emit(ctx, addSource(ctx, ev), start, durationOf(ctx, ev, start, uid));
    }
  }
}

/**
 * Every occurrence that overlaps [fromMs, toMs), from a parsed calendar.
 * Each occurrence carries `sourceIndex`, the index into `sources`, so the
 * content gate runs once per series rather than once per date.
 * @param {ReturnType<typeof parseCalendar>} cal
 * @param {{ fromMs: number, toMs: number, timeZone: string }} window
 */
function occurrencesFrom(cal, { fromMs, toMs, timeZone }) {
  const horizonCivil = civilInZone(toMs, timeZone) + 2 * DAY;
  const ctx = { fromMs, toMs, timeZone, horizonCivil, sources: [], occurrences: [], notes: [] };
  const { masters, overrides } = collectOverrides(ctx, cal.events);
  for (const ev of masters) emitSeries(ctx, ev, overrides.get(uidOf(ev)) ?? new Map());
  emitOverrides(ctx, overrides, new Set(masters.map(uidOf)));
  const { sources, occurrences, notes } = ctx;
  occurrences.sort((a, b) => a.startUtc - b.startUtc || sources[a.sourceIndex].title.localeCompare(sources[b.sourceIndex].title));
  return { sources, occurrences, notes };
}

/** Parses feed text and returns its occurrences in the window. */
export function readFeed(text, window) {
  return occurrencesFrom(parseCalendar(text), window);
}

