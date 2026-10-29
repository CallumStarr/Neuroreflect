// The planner: events on future dates, the to-do list and what is coming up.
// Planner records sit in the same local database as entries, linked by id,
// and the lock seals them like everything else. Repeats are RFC 5545 rules
// expanded with rrule (BSD 3-Clause) in floating wall-clock time, so an event
// at 9:00 stays at 9:00 across the clocks changing.

import { RRule } from 'rrule';
import { getDB } from './db';
import type { Forecast, IfThen, LocalDay, PlanEvent, ReminderMinutes, Repeat, Task, TaskTag } from './types';
import { addDays, localDayOf, uid } from './util';

// ---------- dates in floating time ----------

function floating(day: LocalDay, time: string | null = null): Date {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = (time ?? '00:00').split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm));
}

function dayOfFloating(d: Date): LocalDay {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function daysBetween(a: LocalDay, b: LocalDay): number {
  return Math.round((floating(b).getTime() - floating(a).getTime()) / 86400000);
}

function ruleFor(rule: string, startDay: LocalDay, time: string | null): RRule {
  const options = RRule.parseString(rule);
  return new RRule({ ...options, dtstart: floating(startDay, time) });
}

// ---------- events ----------

export interface Occurrence {
  key: string;
  event: PlanEvent;
  day: LocalDay;
  startTime: string | null;
  endDay: LocalDay;
  endTime: string | null;
}

/** Every occurrence of an event that starts within [from, to], days inclusive. */
export function occurrences(event: PlanEvent, from: LocalDay, to: LocalDay): Occurrence[] {
  const length = Math.max(0, daysBetween(event.startDay, event.endDay));
  const make = (day: LocalDay): Occurrence => ({
    key: `${event.id}@${day}`,
    event,
    day,
    startTime: event.startTime,
    endDay: addDays(day, length),
    endTime: event.endTime,
  });
  if (!event.repeat) {
    // One occurrence, which views draw across every day from day to endDay.
    if (event.endDay < from || event.startDay > to) return [];
    return [make(event.startDay)];
  }
  let rule: RRule;
  try {
    rule = ruleFor(event.repeat.rule, event.startDay, event.startTime);
  } catch {
    return event.startDay >= from && event.startDay <= to ? [make(event.startDay)] : [];
  }
  const skip = new Set(event.exdates);
  // Start early enough to catch occurrences that began before `from` and are still running.
  const after = floating(addDays(from, -length));
  const before = floating(to, '23:59');
  return rule
    .between(after, before, true)
    .slice(0, 1000)
    .map((d) => dayOfFloating(d))
    .filter((day) => !skip.has(day))
    .map(make)
    .filter((o) => o.endDay >= from && o.day <= to);
}

/** The next occurrence that starts on or after `from`, or null. */
export function nextOccurrence(event: PlanEvent, from: LocalDay): Occurrence | null {
  if (!event.repeat) return event.startDay >= from ? occurrences(event, event.startDay, event.startDay)[0] ?? null : null;
  return occurrences(event, from, addDays(from, 400))[0] ?? null;
}

export function newEvent(partial: Partial<PlanEvent> & Pick<PlanEvent, 'title' | 'startDay'>): PlanEvent {
  const now = new Date().toISOString();
  return {
    id: uid('ev'),
    notes: '',
    location: '',
    startTime: null,
    endDay: partial.startDay,
    endTime: null,
    repeat: null,
    exdates: [],
    reminderMinutes: null,
    big: false,
    valueId: null,
    forecastId: null,
    plan: null,
    entryId: null,
    source: 'manual',
    icsUid: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export async function saveEvent(event: PlanEvent): Promise<PlanEvent> {
  const next = { ...event, endDay: event.endDay < event.startDay ? event.startDay : event.endDay, updatedAt: new Date().toISOString() };
  await getDB().events.put(next);
  return next;
}

/** Deletes one occurrence of a repeating event, or the whole event. */
export async function deleteEvent(id: string, onlyDay?: LocalDay): Promise<void> {
  const db = getDB();
  const ev = await db.events.get(id);
  if (!ev) return;
  if (onlyDay && ev.repeat) {
    await db.events.put({ ...ev, exdates: [...new Set([...ev.exdates, onlyDay])], updatedAt: new Date().toISOString() });
    return;
  }
  await db.events.delete(id);
}

// ---------- tasks ----------

export type Bucket = 'today' | 'tomorrow' | 'later';

/** Today holds anything due today or earlier: unfinished tasks roll forward, never turn red. */
export function bucketOf(task: Pick<Task, 'dueDay'>, today: LocalDay): Bucket {
  if (!task.dueDay) return 'later';
  if (task.dueDay <= today) return 'today';
  if (task.dueDay === addDays(today, 1)) return 'tomorrow';
  return 'later';
}

export const REVIEW_AFTER_DAYS = 3;
const REVIEW_UNDATED_AFTER_DAYS = 14;
const REVIEW_AGAIN_AFTER_DAYS = 7;

/**
 * Tasks that have waited a while ask what to do: keep, move or let go.
 * Three days past their day, or two weeks with no date, and never more than once a week.
 */
export function needsReview(task: Task, today: LocalDay): boolean {
  if (task.status !== 'open') return false;
  if (task.reviewedAt && daysBetween(localDayOf(new Date(task.reviewedAt)), today) < REVIEW_AGAIN_AFTER_DAYS) return false;
  if (task.dueDay) return daysBetween(task.dueDay, today) >= REVIEW_AFTER_DAYS;
  return daysBetween(localDayOf(new Date(task.createdAt)), today) >= REVIEW_UNDATED_AFTER_DAYS;
}

export interface NewTask {
  title: string;
  dueDay?: LocalDay | null;
  dueTime?: string | null;
  repeat?: Repeat | null;
  plan?: IfThen | null;
  reminderMinutes?: ReminderMinutes;
  valueId?: string | null;
  entryId?: string | null;
  blockId?: string | null;
  sourceText?: string;
  notes?: string;
  tag?: TaskTag | null;
}

export async function addTask(input: NewTask): Promise<Task> {
  const db = getDB();
  const now = new Date().toISOString();
  const count = await db.tasks.where('status').equals('open').count();
  const task: Task = {
    id: uid('tk'),
    title: input.title.trim().slice(0, 200),
    notes: input.notes ?? '',
    status: 'open',
    dueDay: input.dueDay ?? null,
    dueTime: input.dueDay ? (input.dueTime ?? null) : null,
    repeat: input.repeat ?? null,
    plan: input.plan ?? null,
    reminderMinutes: input.reminderMinutes ?? null,
    valueId: input.valueId ?? null,
    entryId: input.entryId ?? null,
    blockId: input.blockId ?? null,
    sourceText: input.sourceText ?? '',
    order: count,
    createdAt: now,
    updatedAt: now,
    doneAt: null,
    reviewedAt: null,
    letGoNote: '',
    repeatOf: null,
    tag: input.tag ?? null,
  };
  await db.tasks.add(task);
  return task;
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  await getDB().tasks.update(id, { ...patch, updatedAt: new Date().toISOString() });
}

/** The day a repeating task is due next once it is done today. */
export function nextDueDay(task: Pick<Task, 'repeat' | 'dueDay'>, doneDay: LocalDay): LocalDay | null {
  if (!task.repeat) return null;
  try {
    if (task.repeat.fromCompletion) {
      const rule = ruleFor(task.repeat.rule, doneDay, null);
      const after = rule.after(floating(doneDay), false);
      return after ? dayOfFloating(after) : null;
    }
    // On a pattern: the next date on the pattern after today, so an overdue
    // weekly task moves to next week rather than to a date already gone.
    const base = task.dueDay ?? doneDay;
    const rule = ruleFor(task.repeat.rule, base, null);
    const after = rule.after(floating(base > doneDay ? base : doneDay), false);
    return after ? dayOfFloating(after) : null;
  } catch {
    return null;
  }
}

/**
 * Marks a task done. A repeating task keeps its place with its next date, and a
 * done copy is kept so the weekly review can still count it.
 */
export async function completeTask(id: string, now: Date = new Date()): Promise<void> {
  const db = getDB();
  const task = await db.tasks.get(id);
  if (!task || task.status !== 'open') return;
  const iso = now.toISOString();
  const today = localDayOf(now);
  const next = nextDueDay(task, today);
  if (task.repeat && next) {
    await db.transaction('rw', db.tasks, async () => {
      await db.tasks.add({ ...task, id: uid('tk'), status: 'done', doneAt: iso, updatedAt: iso, repeat: null, repeatOf: task.id });
      await db.tasks.put({ ...task, dueDay: next, updatedAt: iso, reviewedAt: null });
    });
    return;
  }
  await db.tasks.put({ ...task, status: 'done', doneAt: iso, updatedAt: iso });
}

export async function reopenTask(id: string): Promise<void> {
  await updateTask(id, { status: 'open', doneAt: null, letGoNote: '' });
}

export async function moveTask(id: string, dueDay: LocalDay | null, dueTime: string | null = null): Promise<void> {
  await updateTask(id, { dueDay, dueTime: dueDay ? dueTime : null, reviewedAt: new Date().toISOString() });
}

export async function keepTask(id: string): Promise<void> {
  await updateTask(id, { reviewedAt: new Date().toISOString() });
}

/** Letting go is a real choice, not a failure: the task leaves the list and is kept for the weekly review. */
export async function letGoTask(id: string, note = ''): Promise<void> {
  await updateTask(id, { status: 'let_go', letGoNote: note.trim().slice(0, 300), doneAt: new Date().toISOString() });
}

export async function deleteTask(id: string): Promise<void> {
  await getDB().tasks.delete(id);
}

/** "When I get home, at the kitchen table, I'll ring Mum." */
export function ifThenSentence(title: string, plan: IfThen | null): string {
  if (!plan || (!plan.when.trim() && !plan.where.trim())) return title;
  const when = plan.when.trim().replace(/^(?:when|if)\s+/i, '');
  const where = plan.where.trim().replace(/^(?:at|in|on)\s+/i, (m) => m.toLowerCase());
  const action = title.trim().replace(/^i(?:'ll| will)\s+/i, '').replace(/[.!]+$/, '');
  const lead = when ? `When ${when}` : 'When I get there';
  const place = where ? `${/^(?:at|in|on|by)\b/i.test(where) ? '' : 'at '}${where}` : '';
  // Lower-case "Ring Mum" to "ring Mum", but leave "IKEA" and names alone.
  const verb = /^[A-Z][a-z]/.test(action) && !/^(?:Mum|Dad|Sam|[A-Z][a-z]+'s)\b/.test(action) ? action.charAt(0).toLowerCase() + action.slice(1) : action;
  return `${lead}${place ? `, ${place}` : ''}, I'll ${verb}.`;
}

// ---------- the agenda ----------

export type AgendaItem =
  | { kind: 'event'; key: string; day: LocalDay; time: string | null; endTime: string | null; title: string; occurrence: Occurrence }
  | { kind: 'task'; key: string; day: LocalDay; time: string | null; endTime: null; title: string; task: Task }
  | { kind: 'forecast'; key: string; day: LocalDay; time: null; endTime: null; title: string; forecast: Forecast };

function sortAgenda(a: AgendaItem, b: AgendaItem): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  // All-day items first, then by time.
  const at = a.time ?? '';
  const bt = b.time ?? '';
  if (at !== bt) return at < bt ? -1 : 1;
  const rank = { forecast: 0, event: 1, task: 2 } as const;
  return rank[a.kind] - rank[b.kind];
}

export interface AgendaData {
  events: PlanEvent[];
  tasks: Task[];
  forecasts: Forecast[];
}

/** Events, dated open tasks and forecasts due, for every day in [from, to]. */
export function buildAgenda(data: AgendaData, from: LocalDay, to: LocalDay, opts: { includeDone?: boolean } = {}): AgendaItem[] {
  const out: AgendaItem[] = [];
  for (const ev of data.events) {
    for (const o of occurrences(ev, from, to)) {
      out.push({ kind: 'event', key: o.key, day: o.day, time: o.startTime, endTime: o.endTime, title: ev.title, occurrence: o });
    }
  }
  for (const t of data.tasks) {
    if (!t.dueDay || t.dueDay < from || t.dueDay > to) continue;
    if (t.status === 'let_go') continue;
    if (t.status === 'done' && !opts.includeDone) continue;
    out.push({ kind: 'task', key: `task:${t.id}`, day: t.dueDay, time: t.dueTime, endTime: null, title: t.title, task: t });
  }
  for (const f of data.forecasts) {
    if (f.calibratedAt || f.targetDate < from || f.targetDate > to) continue;
    out.push({ kind: 'forecast', key: `forecast:${f.id}`, day: f.targetDate, time: null, endTime: null, title: f.eventName, forecast: f });
  }
  return out.sort(sortAgenda);
}

export async function loadAgendaData(): Promise<AgendaData> {
  const db = getDB();
  const [events, tasks, forecasts] = await Promise.all([db.events.toArray(), db.tasks.toArray(), db.forecasts.toArray()]);
  return { events, tasks, forecasts };
}

/** What is coming up in the next `days` days, including today. */
export function comingUp(data: AgendaData, today: LocalDay, days = 7): AgendaItem[] {
  return buildAgenda(data, today, addDays(today, days - 1));
}

/** Big events and planned value activities that ended recently and haven't been written about yet. */
export function recentlyPast(data: AgendaData, today: LocalDay, lookbackDays = 3): Occurrence[] {
  const out: Occurrence[] = [];
  for (const ev of data.events) {
    if (!ev.big && !ev.valueId) continue;
    for (const o of occurrences(ev, addDays(today, -lookbackDays), addDays(today, -1))) out.push(o);
  }
  return out.sort((a, b) => (a.day < b.day ? 1 : -1));
}

export function upcomingBig(data: AgendaData, today: LocalDay, aheadDays = 2): Occurrence[] {
  const out: Occurrence[] = [];
  for (const ev of data.events) {
    if (!ev.big) continue;
    for (const o of occurrences(ev, today, addDays(today, aheadDays))) out.push(o);
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

// ---------- calendar grids ----------

export function startOfWeek(day: LocalDay, weekStartsOn: 0 | 1): LocalDay {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const shift = (date.getDay() - weekStartsOn + 7) % 7;
  return addDays(day, -shift);
}

export function monthGrid(anchor: LocalDay, weekStartsOn: 0 | 1): LocalDay[] {
  const first = `${anchor.slice(0, 7)}-01`;
  const start = startOfWeek(first, weekStartsOn);
  // Always six weeks, so the grid never changes height between months.
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function weekDays(anchor: LocalDay, weekStartsOn: 0 | 1): LocalDay[] {
  const start = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function timeToMinutes(time: string | null): number {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}
