'use client';

import { useEffect, useState } from 'react';
import { describeRepeat } from '@/lib/nl-date';
import type { LocalDay, ReminderMinutes, Repeat } from '@/lib/types';
import { localDayOf } from '@/lib/util';

/** Today's date, which moves on at midnight while the app stays open. */
export function useToday(): LocalDay {
  const [today, setToday] = useState(localDayOf());
  useEffect(() => {
    const t = setInterval(() => {
      const now = localDayOf();
      setToday((prev) => (prev === now ? prev : now));
    }, 30000);
    return () => clearInterval(t);
  }, []);
  return today;
}

export const REMINDER_CHOICES: { value: ReminderMinutes; label: string }[] = [
  { value: null, label: 'No reminder' },
  { value: 0, label: 'At the time' },
  { value: 5, label: '5 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 1440, label: '1 day before' },
];

export const ALL_DAY_REMINDER_CHOICES: { value: ReminderMinutes; label: string }[] = [
  { value: null, label: 'No reminder' },
  { value: 0, label: 'On the day, at 9am' },
  { value: 1440, label: 'The day before, at 9am' },
  { value: 2880, label: 'Two days before, at 9am' },
];

export function ReminderSelect({ id, value, onChange, allDay }: { id: string; value: ReminderMinutes; onChange: (v: ReminderMinutes) => void; allDay: boolean }) {
  const choices = allDay ? ALL_DAY_REMINDER_CHOICES : REMINDER_CHOICES;
  const known = choices.some((c) => c.value === value);
  return (
    <select
      id={id}
      value={value === null ? 'none' : String(value)}
      onChange={(e) => onChange(e.target.value === 'none' ? null : Number(e.target.value))}
      className={selectCls}
    >
      {!known && value !== null && <option value={String(value)}>{value} minutes before</option>}
      {choices.map((c) => (
        <option key={String(c.value)} value={c.value === null ? 'none' : String(c.value)}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type RepeatKind = 'none' | 'daily' | 'weekdays' | 'weekly' | 'fortnightly' | 'monthly' | 'yearly' | 'custom';

function kindOf(repeat: Repeat | null): RepeatKind {
  if (!repeat) return 'none';
  const r = repeat.rule;
  if (r === 'FREQ=DAILY') return 'daily';
  if (r === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR') return 'weekdays';
  if (/^FREQ=WEEKLY(;BYDAY=[A-Z,]+)?$/.test(r)) return 'weekly';
  if (/^FREQ=WEEKLY;INTERVAL=2(;BYDAY=[A-Z,]+)?$/.test(r)) return 'fortnightly';
  if (r === 'FREQ=MONTHLY') return 'monthly';
  if (r === 'FREQ=YEARLY') return 'yearly';
  return 'custom';
}

function weekdayCode(day: LocalDay): string {
  const [y, m, d] = day.split('-').map(Number);
  return DAY_CODES[(new Date(y, m - 1, d).getDay() + 6) % 7];
}

/** Repeat choices in plain words. Typed repeats such as "every other Tuesday" show as custom. */
export function RepeatPicker({ id, value, onChange, day, allowFromCompletion }: { id: string; value: Repeat | null; onChange: (r: Repeat | null) => void; day: LocalDay | null; allowFromCompletion?: boolean }) {
  const kind = kindOf(value);
  const fromCompletion = value?.fromCompletion ?? false;
  const byday = value?.rule.match(/BYDAY=([A-Z,]+)/)?.[1]?.split(',') ?? (day ? [weekdayCode(day)] : []);
  const set = (rule: string | null, fc = fromCompletion) => onChange(rule ? { rule, fromCompletion: fc } : null);
  const choose = (k: RepeatKind) => {
    const days = day ? weekdayCode(day) : 'MO';
    if (k === 'none') set(null);
    else if (k === 'daily') set('FREQ=DAILY');
    else if (k === 'weekdays') set('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    else if (k === 'weekly') set(`FREQ=WEEKLY;BYDAY=${days}`);
    else if (k === 'fortnightly') set(`FREQ=WEEKLY;INTERVAL=2;BYDAY=${days}`);
    else if (k === 'monthly') set('FREQ=MONTHLY');
    else if (k === 'yearly') set('FREQ=YEARLY');
  };
  return (
    <div className="space-y-2">
      <select id={id} value={kind} onChange={(e) => choose(e.target.value as RepeatKind)} className={selectCls}>
        <option value="none">Doesn't repeat</option>
        <option value="daily">Every day</option>
        <option value="weekdays">Every weekday</option>
        <option value="weekly">Every week</option>
        <option value="fortnightly">Every other week</option>
        <option value="monthly">Every month</option>
        <option value="yearly">Every year</option>
        {kind === 'custom' && value && <option value="custom">{describeRepeat(value.rule)}</option>}
      </select>
      {(kind === 'weekly' || kind === 'fortnightly') && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Repeat on">
          {DAY_CODES.map((code, i) => {
            const on = byday.includes(code);
            return (
              <button
                key={code}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on ? byday.filter((d) => d !== code) : [...byday, code];
                  if (!next.length) return;
                  const ordered = DAY_CODES.filter((d) => next.includes(d));
                  set(`FREQ=WEEKLY${kind === 'fortnightly' ? ';INTERVAL=2' : ''};BYDAY=${ordered.join(',')}`);
                }}
                className={`rounded-md border px-2 py-0.5 text-[12px] ${on ? 'border-ember-400 bg-ember-400/15 text-paper-50' : 'border-ink-700 text-paper-500 hover:text-paper-100'}`}
              >
                {DAY_SHORT[i]}
              </button>
            );
          })}
        </div>
      )}
      {allowFromCompletion && value && (
        <label className="flex items-center gap-2 text-[12.5px] text-paper-300">
          <input type="checkbox" checked={fromCompletion} onChange={(e) => set(value.rule, e.target.checked)} className="accent-[#e0aa4a]" />
          Count from the day it&apos;s done, not the date
        </label>
      )}
    </div>
  );
}

export const selectCls =
  'w-full rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-2 text-[13.5px] text-paper-50 [color-scheme:dark] focus:border-ember-400 focus:outline-none';
export const fieldCls = 'w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[14px] text-paper-50 placeholder:text-paper-500 focus:border-ember-400 focus:outline-none';
export const labelCls = 'text-[12.5px] text-paper-300';
