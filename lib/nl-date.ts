// Typed dates and repeats: "ring Mum on Friday", "dentist Thu 3pm",
// "bins every Monday". Dates come from chrono-node (MIT) with British day-month
// order; repeats are a small set of English patterns turned into RFC 5545 rules
// for rrule. Everything is wall-clock local time.

import * as chrono from 'chrono-node';
import type { LocalDay, Repeat } from './types';
import { localDayOf } from './util';

export interface ParsedWhen {
  day: LocalDay | null;
  time: string | null;
  endTime: string | null;
  repeat: Repeat | null;
  /** Span of the date and repeat words in the input, so they can be shown and removed. */
  start: number;
  end: number;
  text: string;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const WEEKDAY_SHORT: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const RRULE_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dayAfter(ref: Date, weekday: number, includeToday: boolean): Date {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  let delta = (weekday - d.getDay() + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  d.setDate(d.getDate() + delta);
  return d;
}

const DAY_WORD = '(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)(?:day|nesday|rsday|urday|sday)?';

interface RepeatMatch {
  repeat: Repeat;
  start: number;
  end: number;
  firstDay: LocalDay;
}

function findRepeat(input: string, ref: Date): RepeatMatch | null {
  const lower = input.toLowerCase();
  const today = localDayOf(ref);
  const tries: { re: RegExp; build: (m: RegExpExecArray) => { rule: string; firstDay: LocalDay } | null }[] = [
    {
      // every weekday
      re: /\bevery\s*(!)?\s*week ?day\b/,
      build: () => {
        const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
        while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
        return { rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', firstDay: localDayOf(d) };
      },
    },
    {
      // every (other) Monday (and Thursday)
      re: new RegExp(`\\bevery\\s*(!)?\\s*(other\\s+)?(${DAY_WORD}(?:\\s*(?:,|and|&)\\s*${DAY_WORD})*)\\b`),
      build: (m) => {
        const names = m[3].split(/\s*(?:,|and|&)\s*/).map((s) => s.trim()).filter(Boolean);
        const days = [...new Set(names.map((n) => WEEKDAY_SHORT[n] ?? WEEKDAY_SHORT[n.slice(0, 3)]).filter((n) => n !== undefined))];
        if (!days.length) return null;
        const first = days.map((d) => dayAfter(ref, d, true)).sort((a, b) => a.getTime() - b.getTime())[0];
        const interval = m[2] ? ';INTERVAL=2' : '';
        return { rule: `FREQ=WEEKLY${interval};BYDAY=${days.sort().map((d) => RRULE_DAY[d]).join(',')}`, firstDay: localDayOf(first) };
      },
    },
    {
      // every 3 days / every two weeks / every 6 months
      re: /\bevery\s*(!)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|week|month|year)s?\b/,
      build: (m) => {
        const n = /^\d+$/.test(m[2]) ? Number(m[2]) : NUMBER_WORDS[m[2]];
        if (!n || n > 365) return null;
        const freq = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[m[3] as 'day']!;
        return { rule: `FREQ=${freq}${n > 1 ? `;INTERVAL=${n}` : ''}`, firstDay: today };
      },
    },
    {
      // every day / week / month / year, every other week, every morning
      re: /\bevery\s*(!)?\s*(other\s+)?(day|night|morning|evening|week|fortnight|month|year)\b/,
      build: (m) => {
        const unit = m[3];
        const freq = unit === 'week' || unit === 'fortnight' ? 'WEEKLY' : unit === 'month' ? 'MONTHLY' : unit === 'year' ? 'YEARLY' : 'DAILY';
        const interval = (m[2] ? 2 : 1) * (unit === 'fortnight' ? 2 : 1);
        return { rule: `FREQ=${freq}${interval > 1 ? `;INTERVAL=${interval}` : ''}`, firstDay: today };
      },
    },
    {
      re: /\b(daily|weekly|fortnightly|monthly|yearly|annually)\b/,
      build: (m) => {
        const map: Record<string, string> = { daily: 'FREQ=DAILY', weekly: 'FREQ=WEEKLY', fortnightly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY', annually: 'FREQ=YEARLY' };
        return { rule: map[m[1]], firstDay: today };
      },
    },
  ];
  for (const t of tries) {
    const m = t.re.exec(lower);
    if (!m) continue;
    const built = t.build(m);
    if (!built) continue;
    return { repeat: { rule: built.rule, fromCompletion: m[1] === '!' }, start: m.index, end: m.index + m[0].length, firstDay: built.firstDay };
  }
  return null;
}

// chrono reads a few everyday phrases as dates that aren't meant as dates:
// "the week", "right now", and durations such as "for an hour".
const NOT_A_DATE = /^(?:(?:the |a |this )?(?:week|month|year|day|now|second|sec|minute|moment)|for\b.*)$/i;

/** "on the 1st", "the 23rd": the next time that day of the month comes round. */
function dayOfMonth(input: string, ref: Date): { day: LocalDay; start: number; end: number; text: string } | null {
  const m = /\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b(?!\s+of\b)/i.exec(input);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 31) return null;
  const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  for (let add = 0; add < 13; add++) {
    const d = new Date(today.getFullYear(), today.getMonth() + add, n);
    if (d.getDate() !== n) continue; // no 31st this month
    if (d.getTime() >= today.getTime()) return { day: localDayOf(d), start: m.index, end: m.index + m[0].length, text: m[0] };
  }
  return null;
}

function endOf(input: string, ref: Date): { day: LocalDay; start: number; end: number; text: string } | null {
  const m = /\b(?:by\s+)?(?:the\s+)?end of (?:the |this )?(week|month)\b/i.exec(input);
  if (!m) return null;
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  if (m[1].toLowerCase() === 'week') {
    // Friday this week; at the weekend, the coming Friday.
    const target = d.getDay() === 6 || d.getDay() === 0 ? dayAfter(d, 5, false) : dayAfter(d, 5, true);
    return { day: localDayOf(target), start: m.index, end: m.index + m[0].length, text: m[0] };
  }
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { day: localDayOf(last), start: m.index, end: m.index + m[0].length, text: m[0] };
}

/**
 * Finds a date, time and repeat in free text. Returns null when there is none.
 * Times are kept only when the person wrote one; "tomorrow evening" is a day.
 */
export function parseWhen(input: string, ref: Date = new Date()): ParsedWhen | null {
  const rep = findRepeat(input, ref);
  // Look for a date in what is left once the repeat words are blanked out.
  const masked = rep ? input.slice(0, rep.start) + ' '.repeat(rep.end - rep.start) + input.slice(rep.end) : input;
  const special = rep ? null : (endOf(masked, ref) ?? dayOfMonth(masked, ref));
  const results = chrono.en.GB.parse(masked, ref, { forwardDate: true }).filter((r) => !NOT_A_DATE.test(r.text.trim()));
  const hit = results[0];

  let day: LocalDay | null = rep?.firstDay ?? special?.day ?? null;
  let time: string | null = null;
  let endTime: string | null = null;
  let start = rep?.start ?? special?.start ?? Number.POSITIVE_INFINITY;
  let end = rep?.end ?? special?.end ?? -1;

  if (hit && !special) {
    const certain = (c: 'day' | 'weekday' | 'month' | 'hour' | 'meridiem') => hit.start.isCertain(c);
    const hasDay = certain('day') || certain('weekday') || certain('month');
    const hasHour = certain('hour');
    const dayIsReal = hasDay || !hasHour || /\b(today|tonight|tomorrow|tmrw|tmr|next week|weekend)\b/i.test(hit.text);
    if (!rep && dayIsReal) day = localDayOf(hit.start.date());
    if (!rep && !day && hasHour) day = localDayOf(hit.start.date());
    if (hasHour) {
      let hour = hit.start.get('hour') ?? 0;
      const minute = hit.start.get('minute') ?? 0;
      // "at 5" with no am or pm almost always means the afternoon. With no day
      // written, that is today if 5pm is still to come, otherwise tomorrow.
      if (!certain('meridiem') && hour >= 1 && hour <= 7) {
        hour += 12;
        if (!rep && !hasDay && !/\b(today|tonight|tomorrow|tmrw|tmr)\b/i.test(hit.text)) {
          const at = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), hour, minute);
          if (at.getTime() <= ref.getTime()) at.setDate(at.getDate() + 1);
          day = localDayOf(at);
        }
      }
      time = `${pad(hour)}:${pad(minute)}`;
      if (hit.end && hit.end.isCertain('hour')) {
        let eh = hit.end.get('hour') ?? hour;
        if (!hit.end.isCertain('meridiem') && eh >= 1 && eh <= 7) eh += 12;
        endTime = `${pad(eh)}:${pad(hit.end.get('minute') ?? 0)}`;
      }
    }
    if (rep && !hasHour && !hasDay) {
      // Nothing useful beyond the repeat.
    } else {
      start = Math.min(start, hit.index);
      end = Math.max(end, hit.index + hit.text.length);
    }
  }

  if (day === null && time === null && !rep) return null;
  if (!Number.isFinite(start) || end < 0) return null;
  // Take in a leading "on", "at" or "by" so removing the span leaves a clean title.
  const lead = /\b(?:on|at|by|for|from)\s+$/i.exec(input.slice(0, start));
  if (lead) start = lead.index;
  return { day, time, endTime, repeat: rep?.repeat ?? null, start, end, text: input.slice(start, end) };
}

/** The input with the date words taken out, tidied into a title. */
export function stripWhen(input: string, parsed: Pick<ParsedWhen, 'start' | 'end'>): string {
  const out = `${input.slice(0, parsed.start)} ${input.slice(parsed.end)}`
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,;:-]+$/g, '')
    .trim();
  return out;
}

// ---------- describing dates and repeats in plain words ----------

export function describeRepeat(rule: string, fromCompletion = false): string {
  const parts = Object.fromEntries(rule.split(';').map((p) => p.split('=') as [string, string]));
  const interval = Number(parts.INTERVAL ?? 1);
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[parts.FREQ as 'DAILY'] ?? 'time';
  let text: string;
  if (parts.FREQ === 'WEEKLY' && parts.BYDAY) {
    const days = parts.BYDAY.split(',');
    if (days.join(',') === 'MO,TU,WE,TH,FR' && interval === 1) text = 'Every weekday';
    else {
      const names = days.map((d) => WEEKDAYS[RRULE_DAY.indexOf(d)]).filter(Boolean).map((n) => n.charAt(0).toUpperCase() + n.slice(1));
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
      text = interval === 2 ? `Every other ${list}` : interval > 2 ? `Every ${interval} weeks on ${list}` : `Every ${list}`;
    }
  } else if (parts.FREQ === 'MONTHLY' && parts.BYMONTHDAY) {
    const n = Number(parts.BYMONTHDAY);
    text = n === -1 ? 'On the last day of every month' : `On the ${ordinal(n)} of every month`;
  } else if (interval === 1) {
    text = { day: 'Every day', week: 'Every week', month: 'Every month', year: 'Every year' }[unit] ?? 'Repeats';
  } else if (interval === 2 && unit === 'week') {
    text = 'Every other week';
  } else {
    text = `Every ${interval} ${unit}s`;
  }
  return fromCompletion ? `${text} after it's done` : text;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function formatTime(time: string | null): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${pad(m)}${suffix}` : `${hour}${suffix}`;
}

/** "Today", "Tomorrow", "Fri 23 Oct", with the time when there is one. */
export function describeWhen(day: LocalDay | null, time: string | null, today: LocalDay = localDayOf()): string {
  if (!day) return time ? formatTime(time) : 'No date';
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const [ty, tm, td] = today.split('-').map(Number);
  const diff = Math.round((date.getTime() - new Date(ty, tm - 1, td).getTime()) / 86400000);
  let label: string;
  if (diff === 0) label = 'Today';
  else if (diff === 1) label = 'Tomorrow';
  else if (diff === -1) label = 'Yesterday';
  else if (diff > 1 && diff < 7) label = date.toLocaleDateString('en-GB', { weekday: 'long' });
  else label = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(y !== ty ? { year: 'numeric' } : {}) });
  return time ? `${label}, ${formatTime(time)}` : label;
}
