// A small iCalendar (RFC 5545) reader for the community calendar's public
// feed: line unfolding, properties, VEVENTs, time zones and the recurrence
// rules the feed uses. Standard library only, so the prebuild needs no new
// package.
//
// Times are handled as "civil" milliseconds: the wall-clock time of an event,
// written as if it were UTC. Recurrence runs on civil time, so a 6 PM weekly
// meetup stays at 6 PM across a daylight saving change, the way RFC 5545
// section 3.3.10 asks. Each instance is then turned into a real instant with
// the event's own time zone.
//
// Time zones come from the IANA data in Node's Intl, not from the feed's
// VTIMEZONE blocks. The feed on 2026-10-18 gave America/Yellowknife a fixed
// UTC-6, while Node's 2026a data and the Denver half of the same Boulder
// series put it on Mountain Time. A TZID Intl does not know falls back to the
// calendar's own zone, and the caller logs it.

const DAY = 86_400_000;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const SUPPORTED_RULE_PARTS = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "WKST"]);

/** The feed could not be read as a calendar. */
export class IcsError extends Error {}

// --------------------------------------------------------------------------
// Lines and properties

/** Joins folded lines (a line break followed by one space or tab). */
export function unfold(text) {
  return String(text).replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "");
}

/**
 * Reads one content line: NAME;PARAM=value;PARAM="quoted":VALUE.
 * Returns null for a line that does not parse.
 */
export function parseLine(line) {
  const head = /^[A-Za-z0-9-]+/.exec(line);
  if (!head) return null;
  const name = head[0].toUpperCase();
  const params = {};
  let i = head[0].length;
  while (line[i] === ";") {
    const eq = line.indexOf("=", i + 1);
    if (eq < 0) return null;
    const read = readParamValue(line, eq + 1);
    if (!read) return null;
    params[line.slice(i + 1, eq).toUpperCase()] = read.value;
    i = read.end;
  }
  if (line[i] !== ":") return null;
  return { name, params, value: line.slice(i + 1) };
}

/** One parameter value from index i: quoted parts and comma lists, up to the next ; or :. Null for an unclosed quote. */
function readParamValue(line, i) {
  let value = "";
  for (;;) {
    if (line[i] === '"') {
      const close = line.indexOf('"', i + 1);
      if (close < 0) return null;
      value += line.slice(i + 1, close);
      i = close + 1;
    } else {
      while (i < line.length && line[i] !== ";" && line[i] !== ":" && line[i] !== ",") value += line[i++];
    }
    if (line[i] !== ",") return { value, end: i };
    value += ",";
    i++;
  }
}

/** Undoes TEXT escaping: \n, \N, \, \; and \\. */
export function unescapeText(value) {
  return String(value).replace(/\\([\\;,nN])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
}

/**
 * Splits a feed into the calendar's own properties and its VEVENTs. Only
 * properties that sit directly in a VEVENT are kept, so a VALARM's
 * DESCRIPTION never replaces the event's.
 * @returns {{ props: Record<string, object[]>, events: Record<string, object[]>[] }}
 */
export function parseCalendar(text) {
  const state = { stack: [], props: {}, events: [], current: null, sawCalendar: false };
  for (const raw of unfold(text).split("\n")) {
    const line = raw.trim() ? parseLine(raw) : null;
    if (!line) continue;
    if (line.name === "BEGIN") beginComponent(state, line.value);
    else if (line.name === "END") endComponent(state);
    else addProperty(state, line);
  }
  if (!state.sawCalendar) throw new IcsError("not an iCalendar feed (no BEGIN:VCALENDAR)");
  return { props: state.props, events: state.events };
}

/** BEGIN: VCALENDAR marks the feed; a VEVENT directly inside it starts an event. */
function beginComponent(state, value) {
  const kind = value.trim().toUpperCase();
  state.stack.push(kind);
  if (kind === "VCALENDAR") state.sawCalendar = true;
  if (kind === "VEVENT" && state.stack.length === 2 && state.stack[0] === "VCALENDAR") state.current = {};
}

/** END: closing a top-level VEVENT keeps it. */
function endComponent(state) {
  const kind = state.stack.pop();
  if (kind === "VEVENT" && state.current && state.stack.length === 1) {
    state.events.push(state.current);
    state.current = null;
  }
}

/** A property, filed under the event or the calendar it sits directly in; one inside a VALARM or VTIMEZONE is dropped. */
function addProperty(state, line) {
  const { stack } = state;
  const top = stack[stack.length - 1];
  if (top === "VEVENT" && state.current && stack.length === 2) (state.current[line.name] ??= []).push(line);
  else if (top === "VCALENDAR" && stack.length === 1) (state.props[line.name] ??= []).push(line);
}

/** The first value of a property, or undefined. */
export function first(event, name) {
  return event[name]?.[0];
}

/** A TEXT property, unescaped and trimmed, or "". */
export function textOf(event, name) {
  const p = first(event, name);
  return p ? unescapeText(p.value).trim() : "";
}

// --------------------------------------------------------------------------
// Time zones

const formatters = new Map();

/** True when Intl knows the zone. */
function isKnownZone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function formatterFor(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** The wall-clock time in tz at a real instant, as civil ms. */
export function civilInZone(utcMs, tz) {
  if (tz === "UTC") return utcMs;
  const parts = {};
  for (const p of formatterFor(tz).formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
}

/** The real instant of a wall-clock time in tz. */
export function zonedToUtc(civilMs, tz) {
  if (tz === "UTC") return civilMs;
  let utc = civilMs - (civilInZone(civilMs, tz) - civilMs);
  // A second pass settles times near a daylight saving change.
  const again = civilMs - (civilInZone(utc, tz) - utc);
  if (again !== utc) utc = again;
  return utc;
}

/** UTC offset of tz at an instant, as "-06:00". */
export function offsetText(utcMs, tz) {
  const minutes = Math.round((civilInZone(utcMs, tz) - utcMs) / 60_000);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

// --------------------------------------------------------------------------
// Dates and times

const DATE_TIME = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/;

/**
 * Reads a DATE or DATE-TIME value. Floating times take defaultTz.
 * @returns {{ civil: number, tz: string, allDay: boolean, utc: number, unknownZone?: string } | null}
 */
export function parseDateValue(value, params = {}, defaultTz) {
  const m = DATE_TIME.exec(String(value).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const allDay = params.VALUE === "DATE" || h === undefined;
  const [hh, mm, ss] = allDay ? [0, 0, 0] : [+h, +mi, +s];
  const civil = Date.UTC(+y, +mo - 1, +d, hh, mm, ss);
  if (Number.isNaN(civil)) return null;
  const { tz, unknownZone } = zoneOf(z, params.TZID, allDay, defaultTz);
  const out = { civil, tz, allDay, utc: zonedToUtc(civil, tz) };
  if (unknownZone) out.unknownZone = unknownZone;
  return out;
}

/** A value's zone: defaultTz for a date, UTC for a trailing Z, else its TZID when Intl knows it (an unknown one is reported). */
function zoneOf(z, tzid, allDay, defaultTz) {
  if (allDay) return { tz: defaultTz };
  if (z) return { tz: "UTC" };
  if (!tzid) return { tz: defaultTz };
  return isKnownZone(tzid) ? { tz: tzid } : { tz: defaultTz, unknownZone: tzid };
}

/** Reads every value of a multi-valued date property such as EXDATE. */
export function parseDateList(props = [], defaultTz) {
  const out = [];
  for (const p of props) {
    for (const v of p.value.split(",")) {
      const d = parseDateValue(v, p.params, defaultTz);
      if (d) out.push(d);
    }
  }
  return out;
}

/** Reads an RFC 5545 DURATION such as PT1H30M or P1D, in ms. Null if bad. */
export function parseDuration(value) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(value).trim());
  if (!m || value.trim() === "P" || /T$/.test(value.trim())) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+w || 0) * 7 + (+d || 0)) * DAY + ((+h || 0) * 3600 + (+mi || 0) * 60 + (+s || 0)) * 1000;
  return sign === "-" ? -ms : ms;
}

// --------------------------------------------------------------------------
// Recurrence

/**
 * Reads an RRULE. `unsupported` lists the parts this reader cannot expand;
 * the caller skips such a series instead of guessing its dates.
 */
export function parseRrule(value) {
  const parts = ruleParts(value);
  const unsupported = Object.keys(parts).filter((k) => !SUPPORTED_RULE_PARTS.has(k));
  const freq = parts.FREQ;
  if (!FREQS.includes(freq)) unsupported.push(`FREQ=${freq ?? ""}`);
  const rule = {
    freq,
    interval: parts.INTERVAL ? Number(parts.INTERVAL) : 1,
    count: parts.COUNT ? Number(parts.COUNT) : undefined,
    until: parts.UNTIL,
    byday: parseByday(parts.BYDAY, unsupported),
    bymonthday: ints(parts.BYMONTHDAY),
    bymonth: ints(parts.BYMONTH),
    wkst: parts.WKST ? WEEKDAYS.indexOf(parts.WKST.toUpperCase()) : 1,
    unsupported,
  };
  unsupported.push(...ruleProblems(rule, parts));
  return rule;
}

const FREQS = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const ints = (text) => (text ? text.split(",").map((x) => Number(x.trim())) : []);

/** An RRULE's KEY=value pairs, keys upper-cased. */
function ruleParts(value) {
  const parts = {};
  for (const piece of String(value).split(";")) {
    const [k, v] = piece.split("=");
    if (k) parts[k.trim().toUpperCase()] = (v ?? "").trim();
  }
  return parts;
}

/** BYDAY as { n, wd }, n 0 for every such weekday. An item it cannot read goes in `unsupported`. */
function parseByday(text, unsupported) {
  const byday = [];
  for (const item of text ? text.split(",") : []) {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(item.trim().toUpperCase());
    if (!m) unsupported.push(`BYDAY=${item}`);
    else byday.push({ n: m[1] ? Number(m[1]) : 0, wd: WEEKDAYS.indexOf(m[2]) });
  }
  return byday;
}

/** The rest of what this reader cannot expand, in the order the checks run. */
function ruleProblems({ freq, interval, count, byday, bymonthday, bymonth, wkst }, parts) {
  const checks = [
    [byday.some((b) => b.n !== 0) && !["MONTHLY", "YEARLY"].includes(freq), "BYDAY with an ordinal"],
    [freq === "YEARLY" && byday.length > 0 && !parts.BYMONTH, "YEARLY BYDAY without BYMONTH"],
    [bymonthday.some((x) => !Number.isInteger(x) || x === 0 || Math.abs(x) > 31), "BYMONTHDAY"],
    [bymonth.some((x) => !Number.isInteger(x) || x < 1 || x > 12), "BYMONTH"],
    [!Number.isInteger(interval) || interval < 1, "INTERVAL"],
    [count !== undefined && (!Number.isInteger(count) || count < 1), "COUNT"],
    [wkst < 0, "WKST"],
  ];
  return checks.filter(([bad]) => bad).map(([, name]) => name);
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Day of the month of the nth weekday wd (n < 0 counts from the end), or null. */
export function nthWeekday(y, m, wd, n) {
  const dim = daysInMonth(y, m);
  if (n > 0) {
    const firstWd = new Date(Date.UTC(y, m, 1)).getUTCDay();
    const day = 1 + ((wd - firstWd + 7) % 7) + (n - 1) * 7;
    return day <= dim ? day : null;
  }
  const lastWd = new Date(Date.UTC(y, m, dim)).getUTCDay();
  const day = dim - ((lastWd - wd + 7) % 7) + (n + 1) * 7;
  return day >= 1 ? day : null;
}

/** Candidate days (1-based) in one month for MONTHLY, or a BYMONTH month of YEARLY. */
function daysInPeriodMonth(rule, y, m, startDay) {
  const dim = daysInMonth(y, m);
  const monthDays = rule.bymonthday.map((d) => (d > 0 ? d : dim + d + 1)).filter((d) => d >= 1 && d <= dim);
  let days;
  if (rule.byday.length) {
    days = [];
    for (const { n, wd } of rule.byday) {
      if (n !== 0) {
        const d = nthWeekday(y, m, wd, n);
        if (d) days.push(d);
      } else {
        for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, m, d)).getUTCDay() === wd) days.push(d);
      }
    }
    if (rule.bymonthday.length) days = days.filter((d) => monthDays.includes(d));
  } else if (rule.bymonthday.length) {
    days = monthDays;
  } else {
    days = startDay <= dim ? [startDay] : [];
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

/**
 * Civil start times of a recurring series, in order, from DTSTART up to
 * horizonCivil. DTSTART always counts as the first instance (RFC 5545
 * section 3.8.5.3). untilUtc and the rule's COUNT end the series early.
 * @param {ReturnType<typeof parseRrule>} rule
 * @param {{ startCivil: number, horizonCivil: number, untilUtc?: number, toUtc: (civil: number) => number, maxPeriods?: number }} o
 */
export function expandRrule(rule, { startCivil, horizonCivil, untilUtc, toUtc, maxPeriods = 20_000 }) {
  const out = [];
  const start = new Date(startCivil);
  const timeOfDay = startCivil - Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const done = (civil) =>
    civil > horizonCivil || (untilUtc !== undefined && toUtc(civil) > untilUtc) || (rule.count !== undefined && out.length >= rule.count);
  const accept = (civil) => {
    if (civil < startCivil) return true;
    if (rule.bymonth.length && !rule.bymonth.includes(new Date(civil).getUTCMonth() + 1)) return true;
    if (done(civil)) return false;
    if (out[out.length - 1] !== civil) out.push(civil);
    return true;
  };
  if (!done(startCivil)) out.push(startCivil);

  const period = { start, startDayMs: startCivil - timeOfDay, horizonCivil };
  const daysOf = PERIOD_DAYS[rule.freq] ?? yearlyDays;
  for (let p = 0; p < maxPeriods; p++) {
    const days = daysOf(rule, p, period);
    if (days === null) return out;
    for (const day of days) if (!accept(day + timeOfDay)) return out;
  }
  throw new IcsError(`recurrence ran past ${maxPeriods} periods`);
}

// The candidate days (civil ms at midnight) of period p of a series, in
// order, or null once the period starts past the horizon. `start` is
// DTSTART as a Date, `startDayMs` its midnight.

/** DAILY: one day, kept when it passes BYDAY and BYMONTHDAY. */
function dailyDays(rule, p, { startDayMs, horizonCivil }) {
  const day = startDayMs + p * rule.interval * DAY;
  if (day > horizonCivil) return null;
  const at = new Date(day);
  const dom = at.getUTCDate();
  const dim = daysInMonth(at.getUTCFullYear(), at.getUTCMonth());
  const domOk = !rule.bymonthday.length || rule.bymonthday.some((d) => (d > 0 ? d : dim + d + 1) === dom);
  const wdOk = !rule.byday.length || rule.byday.some((b) => b.wd === at.getUTCDay());
  return wdOk && domOk ? [day] : [];
}

/** WEEKLY: each BYDAY weekday of the week, or DTSTART's. */
function weeklyDays(rule, p, { start, startDayMs, horizonCivil }) {
  const wd0 = start.getUTCDay();
  const weekStart = startDayMs - ((wd0 - rule.wkst + 7) % 7) * DAY + p * rule.interval * 7 * DAY;
  if (weekStart > horizonCivil) return null;
  const wds = rule.byday.length ? rule.byday.map((b) => b.wd) : [wd0];
  return wds.map((wd) => weekStart + ((wd - rule.wkst + 7) % 7) * DAY).sort((a, b) => a - b);
}

/** MONTHLY: the month's candidate days. */
function monthlyDays(rule, p, { start, horizonCivil }) {
  const y = start.getUTCFullYear() + Math.floor((start.getUTCMonth() + p * rule.interval) / 12);
  const m = (start.getUTCMonth() + p * rule.interval) % 12;
  if (Date.UTC(y, m, 1) > horizonCivil) return null;
  return daysInPeriodMonth(rule, y, m, start.getUTCDate()).map((d) => Date.UTC(y, m, d));
}

/** YEARLY: the candidate days of each BYMONTH month, or of DTSTART's month. */
function yearlyDays(rule, p, { start, horizonCivil }) {
  const y = start.getUTCFullYear() + p * rule.interval;
  if (Date.UTC(y, 0, 1) > horizonCivil) return null;
  const months = rule.bymonth.length ? [...rule.bymonth].sort((a, b) => a - b).map((x) => x - 1) : [start.getUTCMonth()];
  return months.flatMap((m) => daysInPeriodMonth(rule, y, m, start.getUTCDate()).map((d) => Date.UTC(y, m, d)));
}

const PERIOD_DAYS = { DAILY: dailyDays, WEEKLY: weeklyDays, MONTHLY: monthlyDays, YEARLY: yearlyDays };
