// "Add my writing time to my calendar": a repeating calendar event the person
// imports into Outlook, Google Calendar or Apple Calendar. It needs no server,
// and once it is in a calendar that syncs, it reaches their phone too, even
// when NeuroReflect is closed or the computer is off. Writing down a date and
// time made follow-through likelier in a field study of flu jabs (Milkman et
// al. 2011). The title stays neutral, because work calendars are often shared.

import type { LocalDay, WritingPlan } from './types';
import { localDayOf } from './util';

export const CALENDAR_FILE = { label: 'Calendar file', extensions: ['ics'], mime: 'text/calendar' };

const TITLE = 'Writing time';
const DESCRIPTION = 'A few minutes of writing.';

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function floatingStart(day: LocalDay, time: string): string {
  const [hh, mm] = time.split(':');
  return `${day.replace(/-/g, '')}T${hh.padStart(2, '0')}${mm.padStart(2, '0')}00`;
}

/**
 * An .ics file with one event that repeats every day at the person's usual
 * time, in floating local time so it stays at that wall-clock time in their
 * own calendar. Lines end in CRLF, as the format requires.
 */
export function writingTimeIcs(plan: WritingPlan, options: { from?: LocalDay; now?: Date; uid?: string; minutes?: number } = {}): string {
  const now = options.now ?? new Date();
  const from = options.from ?? localDayOf(now);
  const uid = options.uid ?? `writing-time-${now.getTime().toString(36)}@neuroreflect.app`;
  const minutes = options.minutes ?? 15;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NOAH Neurotech//NeuroReflect//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${floatingStart(from, plan.usualTime)}`,
    `DURATION:PT${minutes}M`,
    'RRULE:FREQ=DAILY',
    `SUMMARY:${TITLE}`,
    `DESCRIPTION:${DESCRIPTION}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${TITLE}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}
