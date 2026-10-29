// A forgiving weekly rhythm instead of a streak. The person may choose how many
// days a week they aim to write. Only the current week is ever shown: its days
// fill in as they write, a new week always starts clean, and nothing counts
// what was missed. A broken streak loses the boost an intact one gives, most
// when people blame themselves (Silverman & Barasch 2023), so there is no
// count of days to protect or lose.

import type { LocalDay } from './types';
import { addDays } from './util';

export interface RhythmDay {
  day: LocalDay;
  wrote: boolean;
  isToday: boolean;
  isFuture: boolean;
}

export interface RhythmWeek {
  days: RhythmDay[];
  /** Days written this week. */
  count: number;
  /** The aim, or null with no rhythm set. */
  target: number | null;
  /** True once this week's aim is met. Never false in a way that is shown as a loss. */
  met: boolean;
}

function weekday(day: LocalDay): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** The first day of the week containing `day`. weekStartsOn: 1 Monday, 0 Sunday. */
export function weekStart(day: LocalDay, weekStartsOn: 0 | 1): LocalDay {
  const back = (weekday(day) - weekStartsOn + 7) % 7;
  return addDays(day, -back);
}

/**
 * This week's days, filled in where the person wrote. `writtenDays` is every
 * day with words in an entry; anything outside this week is ignored, so a
 * missed week can never show up here.
 */
export function rhythmWeek(writtenDays: Iterable<LocalDay>, today: LocalDay, weekStartsOn: 0 | 1, target: number | null): RhythmWeek {
  const written = new Set(writtenDays);
  const start = weekStart(today, weekStartsOn);
  const days: RhythmDay[] = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(start, i);
    return { day, wrote: written.has(day), isToday: day === today, isFuture: day > today };
  });
  const count = days.filter((d) => d.wrote).length;
  return { days, count, target, met: target !== null && count >= target };
}

/** A short, loss-free line for the week: "2 of 3 days this week", "Rhythm kept this week". */
export function rhythmLine(week: RhythmWeek): string {
  if (week.target === null) return week.count === 1 ? '1 day this week' : `${week.count} days this week`;
  if (week.met) return week.count > week.target ? `Rhythm kept, ${week.count} days this week` : 'Rhythm kept this week';
  return `${week.count} of ${week.target} days this week`;
}

/** Weeks in which the aim was met, for the person's own figures. Counts only weeks kept, never weeks missed. */
export function weeksKept(writtenDays: Iterable<LocalDay>, from: LocalDay, to: LocalDay, weekStartsOn: 0 | 1, target: number): number {
  const byWeek = new Map<LocalDay, number>();
  for (const d of new Set(writtenDays)) {
    if (d < from || d > to) continue;
    const w = weekStart(d, weekStartsOn);
    byWeek.set(w, (byWeek.get(w) ?? 0) + 1);
  }
  let kept = 0;
  for (const n of byWeek.values()) if (n >= target) kept++;
  return kept;
}
