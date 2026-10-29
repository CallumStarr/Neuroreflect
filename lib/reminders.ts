// Reminders for events and tasks. The times come from the planner; showing
// them is the platform's job: the desktop app hands them to the Rust side,
// which keeps time and shows system notifications even while the window is
// hidden in the tray; a browser tab shows them only while it is open.
//
// While the journal is locked, titles are sealed, so the only thing known is
// when a reminder is due. A small unsealed row keeps those times (no titles),
// and a locked journal says just "You have a reminder" unless the person chose
// to show reminder text while locked.

import { getDB } from './db';
import { describeWhen, formatTime } from './nl-date';
import { occurrences, type AgendaData } from './planner';
import { SCHEDULE_ROW_KEY } from './lock-core';
import type { LocalDay } from './types';
import { addDays, localDayOf } from './util';

export interface DueReminder {
  id: string;
  /** Epoch milliseconds. */
  at: number;
  title: string;
  body: string;
  itemKind: 'event' | 'task';
  itemId: string;
  day: LocalDay;
}

/** All-day items and tasks without a time are reminded about at 9am. */
export const ALL_DAY_REMINDER_TIME = '09:00';
export const SCHEDULE_HORIZON_DAYS = 14;
const MISSED_LOOKBACK_DAYS = 7;

export function localMs(day: LocalDay, time: string | null): number {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = (time ?? ALL_DAY_REMINDER_TIME).split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

function leadText(minutes: number): string {
  if (minutes === 0) return 'Now';
  if (minutes < 60) return `In ${minutes} minutes`;
  if (minutes === 60) return 'In an hour';
  if (minutes < 1440) return `In ${Math.round(minutes / 60)} hours`;
  if (minutes === 1440) return 'Tomorrow';
  return `In ${Math.round(minutes / 1440)} days`;
}

/** Reminders due in [fromMs, toMs). */
export function remindersBetween(data: AgendaData, fromMs: number, toMs: number): DueReminder[] {
  const out: DueReminder[] = [];
  const fromDay = addDays(localDayOf(new Date(fromMs)), -1);
  // Reminders can be days ahead of their item, so look further forward.
  const toDay = addDays(localDayOf(new Date(toMs)), 8);
  for (const ev of data.events) {
    if (ev.reminderMinutes === null || ev.reminderMinutes === undefined) continue;
    for (const o of occurrences(ev, fromDay, toDay)) {
      const at = localMs(o.day, o.startTime) - ev.reminderMinutes * 60000;
      if (at < fromMs || at >= toMs) continue;
      const when = o.startTime ? `${describeWhen(o.day, null)}, ${formatTime(o.startTime)}` : describeWhen(o.day, null);
      out.push({
        id: `ev:${ev.id}:${o.day}:${ev.reminderMinutes}`,
        at,
        title: ev.title,
        body: [ev.reminderMinutes ? leadText(ev.reminderMinutes) : o.startTime ? 'Starting now' : 'Today', when, ev.location].filter(Boolean).join(' · '),
        itemKind: 'event',
        itemId: ev.id,
        day: o.day,
      });
    }
  }
  for (const t of data.tasks) {
    if (t.status !== 'open' || !t.dueDay || t.reminderMinutes === null || t.reminderMinutes === undefined) continue;
    const at = localMs(t.dueDay, t.dueTime) - t.reminderMinutes * 60000;
    if (at < fromMs || at >= toMs) continue;
    out.push({
      id: `tk:${t.id}:${t.dueDay}:${t.dueTime ?? ''}:${t.reminderMinutes}`,
      at,
      title: t.title,
      body: t.plan && (t.plan.when || t.plan.where) ? `Your plan: ${[t.plan.when, t.plan.where].filter(Boolean).join(', ')}` : `To do · ${describeWhen(t.dueDay, t.dueTime)}`,
      itemKind: 'task',
      itemId: t.id,
      day: t.dueDay,
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

export function upcomingReminders(data: AgendaData, now: number = Date.now()): DueReminder[] {
  return remindersBetween(data, now, now + SCHEDULE_HORIZON_DAYS * 86400000);
}

/** Reminders that fell due while NeuroReflect was closed and were never shown. */
export async function missedReminders(data: AgendaData, sinceIso: string | null, now: number = Date.now()): Promise<DueReminder[]> {
  const floor = now - MISSED_LOOKBACK_DAYS * 86400000;
  const since = Math.max(floor, sinceIso ? new Date(sinceIso).getTime() : now);
  if (since >= now) return [];
  const due = remindersBetween(data, since, now);
  if (!due.length) return [];
  const shown = new Set((await getDB().reminderLog.bulkGet(due.map((r) => r.id))).filter(Boolean).map((r) => r!.id));
  return due.filter((r) => !shown.has(r.id));
}

export async function markShown(ids: string[], at: Date = new Date()): Promise<void> {
  if (!ids.length) return;
  await getDB().reminderLog.bulkPut(ids.map((id) => ({ id, firedAt: at.toISOString() })));
}

// ---------- the unsealed schedule (times only) ----------

export interface ScheduleRow {
  /** Epoch milliseconds and opaque ids. Titles only if the person chose to show them while locked. */
  items: { id: string; at: number; title?: string; body?: string }[];
  updatedAt: string;
}

/** Items whose text is safe to keep unsealed, such as the writing nudge's locked wording. */
export interface PlainScheduleItem {
  id: string;
  at: number;
  title: string;
  body: string;
}

export function scheduleRowFor(reminders: DueReminder[], includeText: boolean, plain: PlainScheduleItem[] = []): ScheduleRow {
  const items: ScheduleRow['items'] = [
    ...reminders.map((r) => (includeText ? { id: r.id, at: r.at, title: r.title, body: r.body } : { id: r.id, at: r.at })),
    ...plain.map((p) => ({ id: p.id, at: p.at, title: p.title, body: p.body })),
  ];
  return { items: items.sort((a, b) => a.at - b.at).slice(0, 200), updatedAt: new Date().toISOString() };
}

let lastWritten = '';
/** Keeps the unsealed schedule row in step; skips the write when nothing changed. */
export async function writeSchedule(reminders: DueReminder[], includeText = false, plain: PlainScheduleItem[] = []): Promise<void> {
  const row = scheduleRowFor(reminders, includeText, plain);
  const signature = JSON.stringify(row.items);
  if (signature === lastWritten) return;
  lastWritten = signature;
  await getDB().settings.put({ key: SCHEDULE_ROW_KEY, value: row });
}

export async function readSchedule(): Promise<ScheduleRow | null> {
  const row = await getDB().settings.get(SCHEDULE_ROW_KEY);
  return (row?.value as ScheduleRow | undefined) ?? null;
}

export const LOCKED_REMINDER = { title: 'You have a reminder', body: 'Unlock NeuroReflect to see it.' };
