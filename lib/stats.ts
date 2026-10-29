// The person's own figures, worked out on the device. Nothing here is sent
// anywhere. Testers can export a summary of counts only: no text, no feelings,
// no entry dates, and nothing about what was written.

import { getDB } from './db';
import { loadEntryFacts, loadFiredNudges } from './engagement';
import { backedOff, nudgeFollowThrough, type EntryFact } from './nudge';
import { weeksKept, weekStart } from './rhythm';
import type { AppSettings, Entry, LocalDay } from './types';
import { addDays, localDayOf } from './util';

export interface Figures {
  entries: number;
  entriesLast28: number;
  /** Weeks with any writing, of the last eight. */
  weeksWrittenOf8: number;
  /** Weeks from the first entry's week to this one, at most eight, so a new person is never measured against weeks before they started. */
  weeksSinceStart: number;
  /** Wrote in each of the two weeks before this one, and again this week. */
  currentReturn: boolean;
  rated: number;
  /** Share of rated entries scored 4 or 5, or null with none rated. */
  valuedShare: number | null;
  nudges: { shownLast28: number; within2h: number; ignored: number; pausedNow: boolean };
  rhythm: { target: number | null; weeksKeptOf8: number | null };
  habit: { at: string; score: number }[];
  warnings: {
    /** Entries started between midnight and 4am, last 28 days. */
    lateNight: number;
    /** Days with three or more entries started, last 28 days. */
    busyDays: number;
    /** Entries that tripped the step-back guard, per entry, last 28 days. */
    guardPerEntry: number | null;
    /** Co-pilot questions and lenses per entry, last 28 days. */
    copilotPerEntry: number | null;
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Weeks from one week start to another, counting both. */
function weekSpan(from: LocalDay, to: LocalDay): number {
  const at = (d: LocalDay) => {
    const [y, m, dd] = d.split('-').map(Number);
    return new Date(y, m - 1, dd).getTime();
  };
  return Math.round((at(to) - at(from)) / (7 * 86400000)) + 1;
}

export function currentUserReturn(writtenDays: Set<LocalDay>, today: LocalDay, weekStartsOn: 0 | 1): boolean {
  const thisWeek = weekStart(today, weekStartsOn);
  const wroteIn = (start: LocalDay) => [...writtenDays].some((d) => d >= start && d <= addDays(start, 6));
  return wroteIn(addDays(thisWeek, -14)) && wroteIn(addDays(thisWeek, -7)) && wroteIn(thisWeek);
}

export async function computeFigures(settings: AppSettings, now: Date = new Date()): Promise<Figures> {
  const db = getDB();
  const today = localDayOf(now);
  const since28 = addDays(today, -27);
  const since8w = addDays(weekStart(today, settings.planner.weekStartsOn), -49);
  const [facts, fired, entries, turns] = await Promise.all([loadEntryFacts(), loadFiredNudges(), db.entries.toArray(), db.copilotTurns.toArray()]);
  const written = new Set(facts.filter((f) => f.words > 0).map((f) => f.localDay));
  const recent = facts.filter((f) => f.localDay >= since28 && f.words > 0);

  const weeks = new Set([...written].filter((d) => d >= since8w).map((d) => weekStart(d, settings.planner.weekStartsOn)));
  const first = [...written].sort()[0];
  const weeksSinceStart = first ? Math.min(8, weekSpan(weekStart(first, settings.planner.weekStartsOn), weekStart(today, settings.planner.weekStartsOn))) : 0;
  const rated = entries.filter((e: Entry) => e.worth);
  const valued = rated.filter((e) => (e.worth?.score ?? 0) >= 4).length;

  const fired28 = fired.filter((f) => f.day >= since28);
  const follow = nudgeFollowThrough(fired28, facts);
  const nudgeOff = !settings.engagement.nudge.enabled || !settings.engagement.plan;
  const paused = nudgeOff || (!!settings.engagement.nudge.pausedUntil && settings.engagement.nudge.pausedUntil >= today) || backedOff({ fired, entries: facts, now, engagement: settings.engagement });

  const startHour = (f: EntryFact) => new Date(f.createdAt).getHours();
  const perDay = new Map<LocalDay, number>();
  for (const f of recent) perDay.set(f.localDay, (perDay.get(f.localDay) ?? 0) + 1);
  const recentIds = new Set(recent.map((f) => f.id));
  const copilot = turns.filter((t) => recentIds.has(t.entryId) && t.role === 'assistant' && t.mode !== 'synthesis' && t.mode !== 'exercise').length;

  const target = settings.engagement.rhythm;
  return {
    entries: facts.filter((f) => f.words > 0).length,
    entriesLast28: recent.length,
    weeksWrittenOf8: weeks.size,
    weeksSinceStart,
    currentReturn: currentUserReturn(written, today, settings.planner.weekStartsOn),
    rated: rated.length,
    valuedShare: rated.length ? round2(valued / rated.length) : null,
    nudges: { shownLast28: follow.shown, within2h: follow.within2h, ignored: follow.ignored, pausedNow: paused },
    rhythm: { target, weeksKeptOf8: target === null ? null : weeksKept(written, since8w, today, settings.planner.weekStartsOn, target) },
    habit: settings.engagement.habitChecks,
    warnings: {
      lateNight: recent.filter((f) => startHour(f) < 4).length,
      busyDays: [...perDay.values()].filter((n) => n >= 3).length,
      guardPerEntry: recent.length ? round2(recent.filter((f) => f.circled).length / recent.length) : null,
      copilotPerEntry: recent.length ? round2(copilot / recent.length) : null,
    },
  };
}

/**
 * What a tester may choose to send: counts and settings only. No entry text,
 * no feelings, no dates, no titles, no names, nothing from the planner.
 */
export function usageSummary(f: Figures, settings: AppSettings, appVersion: string): Record<string, unknown> {
  return {
    kind: 'neuroreflect-usage-summary',
    version: 1,
    appVersion,
    entries: f.entries,
    entriesLast28Days: f.entriesLast28,
    weeksWithWritingOfLast8: f.weeksWrittenOf8,
    weeksSinceFirstEntryUpTo8: f.weeksSinceStart,
    wroteThisWeekAndTheTwoBefore: f.currentReturn,
    ratedEntries: f.rated,
    valuedShare: f.valuedShare,
    nudgesShownLast28Days: f.nudges.shownLast28,
    nudgesFollowedWithin2Hours: f.nudges.within2h,
    nudgesNotActedOn: f.nudges.ignored,
    nudgePausedOrOff: f.nudges.pausedNow,
    rhythmTarget: f.rhythm.target,
    rhythmWeeksKeptOfLast8: f.rhythm.weeksKeptOf8,
    habitCheckScores: f.habit.map((h) => h.score),
    lateNightEntriesLast28Days: f.warnings.lateNight,
    daysWithThreeOrMoreEntriesLast28Days: f.warnings.busyDays,
    stepBackGuardPerEntry: f.warnings.guardPerEntry,
    copilotQuestionsPerEntry: f.warnings.copilotPerEntry,
    settings: {
      guidanceLevel: settings.guidance.level,
      nudgeOn: settings.engagement.nudge.enabled && !!settings.engagement.plan,
      nudgeFrequency: settings.engagement.nudge.frequency,
      quietHoursOn: settings.engagement.quietHours.enabled,
      todaysQuestionOn: settings.engagement.todaysQuestion,
      provider: settings.provider.primary === 'heuristic' ? 'built-in' : 'ai',
    },
  };
}

// ---------- the habit check ----------

/**
 * The Self-Report Behavioural Automaticity Index: four items, each rated from
 * 1 (strongly disagree) to 7 (strongly agree) (Gardner et al. 2012).
 */
export const HABIT_ITEMS = [
  'Writing in my journal is something I do automatically.',
  'Writing in my journal is something I do without having to consciously remember.',
  'Writing in my journal is something I do without thinking.',
  'Writing in my journal is something I start doing before I realise I am doing it.',
];

export const HABIT_EVERY_DAYS = 28;

export function habitCheckDue(settings: AppSettings, now: Date = new Date()): boolean {
  if (!settings.engagement.tester || !settings.engagement.plan) return false;
  const last = settings.engagement.habitChecks.at(-1);
  if (!last) return true;
  return now.getTime() - new Date(last.at).getTime() >= HABIT_EVERY_DAYS * 86400000;
}
