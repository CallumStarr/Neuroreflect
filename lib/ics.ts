// One-way calendar import from an .ics file (RFC 5545), for example an export
// from Google Calendar or Outlook. Events are copied into the planner once and
// stay on this device; nothing syncs back, and importing the same file again
// updates what came from it rather than adding duplicates.

import { getDB } from './db';
import { newEvent } from './planner';
import type { LocalDay, PlanEvent } from './types';
import { addDays, localDayOf } from './util';

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

export interface IcsEvent {
  uid: string;
  recurrenceId: LocalDay | null;
  title: string;
  notes: string;
  location: string;
  startDay: LocalDay;
  startTime: string | null;
  endDay: LocalDay;
  endTime: string | null;
  rrule: string | null;
  exdates: LocalDay[];
  cancelled: boolean;
}

// Outlook writes Windows zone names. The common ones, as IANA names.
const WINDOWS_ZONES: Record<string, string> = {
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  UTC: 'UTC',
};

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseLine(line: string): Prop | null {
  // NAME;PARAM=VALUE;PARAM="QUOTED":VALUE
  let i = 0;
  let inQuote = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    if (c === ':' && !inQuote) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const [name, ...rest] = head.split(';');
  const params: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The offset of a time zone from UTC at an instant, in minutes. */
function zoneOffsetMinutes(zone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((asUtc - at.getTime()) / 60000);
  } catch {
    return null;
  }
}

/** A DTSTART-style value as a local day and time on this device. */
export function toLocal(value: string, params: Record<string, string>): { day: LocalDay; time: string | null } | null {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date || params.VALUE === 'DATE') {
    const m = date ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
    if (!m) return null;
    return { day: `${m[1]}-${m[2]}-${m[3]}`, time: null };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  let instant: Date | null = null;
  if (m[7]) instant = new Date(Date.UTC(y, mo - 1, d, h, mi));
  else if (params.TZID) {
    const zone = WINDOWS_ZONES[params.TZID] ?? params.TZID;
    const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
    const offset = zoneOffsetMinutes(zone, guess);
    if (offset !== null) {
      // Correct once more around a clock change.
      const first = new Date(guess.getTime() - offset * 60000);
      const offset2 = zoneOffsetMinutes(zone, first) ?? offset;
      instant = new Date(guess.getTime() - offset2 * 60000);
    }
  }
  if (!instant) return { day: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` }; // floating time
  return { day: localDayOf(instant), time: `${pad(instant.getHours())}:${pad(instant.getMinutes())}` };
}

function durationMinutes(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v);
  if (!m) return null;
  const mins = Number(m[2] ?? 0) * 7 * 1440 + Number(m[3] ?? 0) * 1440 + Number(m[4] ?? 0) * 60 + Number(m[5] ?? 0);
  return m[1] === '-' ? -mins : mins;
}

function addMinutesTo(day: LocalDay, time: string | null, minutes: number): { day: LocalDay; time: string | null } {
  if (!time) return { day: addDays(day, Math.max(0, Math.round(minutes / 1440) - 1)), time: null };
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const dt = new Date(y, m - 1, d, h, mi + minutes);
  return { day: localDayOf(dt), time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}` };
}

export function parseIcs(text: string): IcsEvent[] {
  const out: IcsEvent[] = [];
  let current: Prop[] | null = null;
  let depth = 0;
  for (const raw of unfold(text)) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (/^BEGIN:VEVENT$/i.test(line)) {
      current = [];
      depth = 0;
      continue;
    }
    if (!current) continue;
    // Skip nested components such as VALARM.
    if (/^BEGIN:/i.test(line)) {
      depth++;
      continue;
    }
    if (/^END:VEVENT$/i.test(line) && depth === 0) {
      const ev = toEvent(current);
      if (ev) out.push(ev);
      current = null;
      continue;
    }
    if (/^END:/i.test(line)) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;
    const p = parseLine(line);
    if (p) current.push(p);
  }
  return out;
}

function toEvent(props: Prop[]): IcsEvent | null {
  const one = (n: string) => props.find((p) => p.name === n);
  const start = one('DTSTART');
  if (!start) return null;
  const s = toLocal(start.value, start.params);
  if (!s) return null;
  let end: { day: LocalDay; time: string | null } = { day: s.day, time: s.time };
  const dtend = one('DTEND');
  const duration = one('DURATION');
  if (dtend) {
    const e = toLocal(dtend.value, dtend.params);
    // DTEND is exclusive: an all-day event on the 5th ends on the 6th.
    if (e) end = e.time === null && s.time === null ? { day: addDays(e.day, -1) < s.day ? s.day : addDays(e.day, -1), time: null } : e;
  } else if (duration) {
    const mins = durationMinutes(duration.value);
    if (mins !== null) end = addMinutesTo(s.day, s.time, mins);
  } else if (s.time) {
    end = addMinutesTo(s.day, s.time, 60);
  }
  const rec = one('RECURRENCE-ID');
  const rrule = one('RRULE');
  const exdates: LocalDay[] = [];
  for (const p of props.filter((x) => x.name === 'EXDATE')) {
    for (const v of p.value.split(',')) {
      const d = toLocal(v.trim(), p.params);
      if (d) exdates.push(d.day);
    }
  }
  return {
    uid: one('UID')?.value ?? `${s.day}T${s.time ?? ''}:${one('SUMMARY')?.value ?? ''}`,
    recurrenceId: rec ? (toLocal(rec.value, rec.params)?.day ?? null) : null,
    title: unescapeText(one('SUMMARY')?.value ?? 'Untitled event').slice(0, 200),
    notes: unescapeText(one('DESCRIPTION')?.value ?? '').slice(0, 2000),
    location: unescapeText(one('LOCATION')?.value ?? '').slice(0, 200),
    startDay: s.day,
    startTime: s.time,
    endDay: end.day < s.day ? s.day : end.day,
    endTime: s.time ? end.time : null,
    // DTSTART inside the rule is ours to set; the rest of the rule is kept.
    rrule: rrule ? rrule.value.split(';').filter((part) => !/^DTSTART=/i.test(part)).join(';') : null,
    exdates,
    cancelled: (one('STATUS')?.value ?? '').toUpperCase() === 'CANCELLED',
  };
}

export interface ImportReport {
  added: number;
  updated: number;
  skipped: number;
}

const KEEP_PAST_DAYS = 90;
const MAX_EVENTS = 3000;

/** Copies events into the planner. Re-importing the same calendar updates its events. */
export async function importIcs(text: string, today: LocalDay = localDayOf()): Promise<ImportReport> {
  const parsed = parseIcs(text);
  if (!parsed.length) throw new Error('No events were found in that file. Is it an .ics calendar export?');
  const db = getDB();
  const existing = (await db.events.toArray()).filter((e) => e.source === 'ics' && e.icsUid);
  const byKey = new Map(existing.map((e) => [e.icsUid!, e]));
  const report: ImportReport = { added: 0, updated: 0, skipped: 0 };
  const cutoff = addDays(today, -KEEP_PAST_DAYS);
  const masters = new Map<string, PlanEvent>();
  const writes: PlanEvent[] = [];

  for (const ev of parsed.slice(0, MAX_EVENTS)) {
    if (ev.cancelled || (!ev.rrule && ev.endDay < cutoff)) {
      report.skipped++;
      continue;
    }
    const key = ev.recurrenceId ? `${ev.uid}@${ev.recurrenceId}` : ev.uid;
    const prior = byKey.get(key);
    const base = prior ?? newEvent({ title: ev.title, startDay: ev.startDay, source: 'ics', icsUid: key });
    const next: PlanEvent = {
      ...base,
      title: ev.title,
      notes: ev.notes,
      location: ev.location,
      startDay: ev.startDay,
      startTime: ev.startTime,
      endDay: ev.endDay,
      endTime: ev.endTime,
      repeat: ev.rrule ? { rule: ev.rrule, fromCompletion: false } : null,
      exdates: ev.exdates,
      source: 'ics',
      icsUid: key,
      updatedAt: new Date().toISOString(),
    };
    if (prior) report.updated++;
    else report.added++;
    writes.push(next);
    if (!ev.recurrenceId) masters.set(ev.uid, next);
  }
  // A moved occurrence replaces its slot in the repeating event it belongs to.
  for (const ev of parsed) {
    if (!ev.recurrenceId) continue;
    const master = masters.get(ev.uid);
    if (master && !master.exdates.includes(ev.recurrenceId)) master.exdates = [...master.exdates, ev.recurrenceId];
  }
  await db.events.bulkPut(writes);
  return report;
}
