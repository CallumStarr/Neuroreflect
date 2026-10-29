// The daily nudge: one at most, an hour after the person's chosen writing
// moment, and only if they haven't written that day. The routine is the cue
// and the nudge is the backup, because relying on reminders "supported
// repetition but hindered habit development, while the use of event-based
// cues led to increased automaticity" (Stawarz, Cox & Blandford 2015).
//
// Everything here is pure: the same inputs give the same nudges, so the rules
// can be tested without a database, a clock or a window.

import { questionFor } from './daily-question';
import {
  NUDGE_LOCKED,
  NUDGE_NEUTRAL,
  NUDGE_NEXT_QUESTION,
  NUDGE_PLAIN,
  NUDGE_REALITY_CHECK,
  nudgeAfterEvent,
  nudgeQuestion,
  nudgeWeek,
  type NudgeText,
} from './nudge-copy';
import { weekStart } from './rhythm';
import type { EngagementSettings, LocalDay, WritingPlan } from './types';
import { addDays } from './util';

export type NudgeKind = 'week' | 'reality-check' | 'after-event' | 'next-question' | 'question' | 'plain' | 'neutral';

export interface Nudge {
  /** One per day: nudge:YYYY-MM-DD. */
  id: string;
  day: LocalDay;
  /** Epoch milliseconds, local wall-clock time. */
  at: number;
  kind: NudgeKind;
  text: NudgeText;
  /** What a locked journal may show. Never anything personal. */
  lockedText: NudgeText;
}

export interface EntryFact {
  id: string;
  localDay: LocalDay;
  /** Epoch milliseconds. */
  createdAt: number;
  updatedAt: number;
  words: number;
  complete: boolean;
  /** The entry tripped the rumination guard when last measured. */
  circled: boolean;
  nextQuestion: string | null;
  /** Prompt id the entry started from, if any. */
  promptId: string | null;
}

export interface NudgeInputs {
  now: Date;
  engagement: EngagementSettings;
  /** 0 = Sunday. The weekly chapter's day. */
  reviewDay: number;
  weekStartsOn: 0 | 1;
  avoidTopics: string[];
  entries: EntryFact[];
  /** Nudges already shown, from the reminder log. */
  fired: { day: LocalDay; at: number }[];
  /** Forecasts not yet checked against how things went. */
  openForecasts: { targetDate: LocalDay }[];
  /** Planner events marked as mattering: the day each ended, and when (minutes after midnight, null if all day). */
  eventsThatMatter: { day: LocalDay; endMinute: number | null; title: string }[];
}

export const NUDGE_DAYS_AHEAD = 7;
export const IGNORED_IN_A_ROW = 3;
const DAY_MS = 86400000;

export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Minutes after midnight as "HH:MM". */
export function timeOfMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function atMinutes(day: LocalDay, minutes: number): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60).getTime();
}

function weekday(day: LocalDay): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function localDayFromDate(date: Date): LocalDay {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** True when a minute of the day falls in quiet hours, which may run over midnight. */
export function inQuietHours(minute: number, quiet: EngagementSettings['quietHours']): boolean {
  if (!quiet.enabled) return false;
  const from = minutesOf(quiet.from);
  const to = minutesOf(quiet.to);
  if (from === to) return false;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

/**
 * When the nudge goes out on a day, in minutes after midnight, or null when it
 * can't: the moment itself falls in quiet hours. A nudge that would land in
 * quiet hours goes out just before they start instead.
 */
export function nudgeMinute(engagement: EngagementSettings): number | null {
  const plan = engagement.plan;
  if (!plan) return null;
  const usual = minutesOf(plan.usualTime);
  if (inQuietHours(usual, engagement.quietHours)) return null;
  const wanted = Math.min(usual + engagement.nudge.delayMinutes, 24 * 60 - 1);
  if (!inQuietHours(wanted, engagement.quietHours)) return wanted;
  const quietStart = minutesOf(engagement.quietHours.from);
  return Math.max(usual, quietStart - 1);
}

/** Days with words in an entry. */
export function writtenDays(entries: EntryFact[]): Set<LocalDay> {
  return new Set(entries.filter((e) => e.words > 0).map((e) => e.localDay));
}

/** A shown nudge counts as acted on when an entry on that day was started or written in after it. */
export function actedOn(fired: { day: LocalDay; at: number }, entries: EntryFact[]): boolean {
  return entries.some((e) => e.localDay === fired.day && e.words > 0 && (e.createdAt >= fired.at - 60000 || e.updatedAt >= fired.at));
}

/**
 * The time of the last of three ignored nudges in a row, if the most recent
 * three shown after `after` were all ignored; otherwise null. A nudge shown
 * today that may still be acted on is left out until the day is over.
 */
export function ignoredRunSince(inputs: Pick<NudgeInputs, 'fired' | 'entries' | 'now'>, after = 0): number | null {
  const today = localDayFromDate(inputs.now);
  const done = inputs.fired.filter((f) => f.day < today && f.at > after).sort((a, b) => b.at - a.at);
  if (done.length < IGNORED_IN_A_ROW) return null;
  const lastThree = done.slice(0, IGNORED_IN_A_ROW);
  if (lastThree.some((f) => actedOn(f, inputs.entries))) return null;
  return lastThree[0].at;
}

/**
 * The nudge stops after three ignored in a row until the person answers the
 * offer that follows. After an answer, it takes three more ignored in a row.
 */
export function backedOff(inputs: Pick<NudgeInputs, 'fired' | 'entries' | 'now' | 'engagement'>): boolean {
  const answered = inputs.engagement.nudge.backoffAnsweredAt ? new Date(inputs.engagement.nudge.backoffAnsweredAt).getTime() : 0;
  return ignoredRunSince(inputs, answered) !== null;
}

function lastComplete(entries: EntryFact[]): EntryFact | null {
  const done = entries.filter((e) => e.complete).sort((a, b) => b.updatedAt - a.updatedAt);
  return done[0] ?? null;
}

/** What the nudge on a day should carry, most useful first. */
export function pickNudge(inputs: NudgeInputs, day: LocalDay, minute: number): { kind: NudgeKind; text: NudgeText; lockedText: NudgeText } {
  const { engagement, entries } = inputs;
  const last = lastComplete(entries);
  const circled = !!last?.circled;
  const question = questionFor(day, inputs.avoidTopics, circled);
  const questionText = (): { kind: NudgeKind; text: NudgeText; lockedText: NudgeText } =>
    engagement.todaysQuestion && question
      ? { kind: 'question', text: nudgeQuestion(question.question.text), lockedText: question.gentle ? NUDGE_LOCKED : nudgeQuestion(question.question.text) }
      : { kind: circled ? 'neutral' : 'plain', text: circled ? NUDGE_NEUTRAL : NUDGE_PLAIN, lockedText: NUDGE_LOCKED };

  // 1. The weekly chapter on the review day: counts only.
  if (weekday(day) === inputs.reviewDay) {
    const start = weekStart(day, inputs.weekStartsOn);
    const count = entries.filter((e) => e.words > 0 && e.localDay >= start && e.localDay <= day).length;
    if (count > 0) return { kind: 'week', text: nudgeWeek(count), lockedText: NUDGE_LOCKED };
  }
  // After an entry that circled, nothing reopens a topic.
  if (circled) return questionText();

  // 2. A forecast whose day has come.
  if (inputs.openForecasts.some((f) => f.targetDate <= day && f.targetDate >= addDays(day, -7))) {
    return { kind: 'reality-check', text: NUDGE_REALITY_CHECK, lockedText: NUDGE_LOCKED };
  }
  // 3. Something that mattered, just past.
  const past = inputs.eventsThatMatter.find((e) => e.day === addDays(day, -1) || (e.day === day && e.endMinute !== null && e.endMinute <= minute));
  if (past) return { kind: 'after-event', text: nudgeAfterEvent(engagement.nudge.showEventNames ? past.title : null), lockedText: NUDGE_LOCKED };

  // 4. A question the person left themselves, not yet picked up.
  if (last?.nextQuestion && !entries.some((e) => e.createdAt > last.updatedAt && e.words > 0)) {
    return { kind: 'next-question', text: NUDGE_NEXT_QUESTION, lockedText: NUDGE_LOCKED };
  }
  // 5. Today's question, or a plain invitation.
  return questionText();
}

/** The nudges to schedule from now, one a day at most, for the next week. */
export function planNudges(inputs: NudgeInputs, daysAhead = NUDGE_DAYS_AHEAD): Nudge[] {
  const { engagement, now } = inputs;
  if (!engagement.plan || !engagement.nudge.enabled) return [];
  const minute = nudgeMinute(engagement);
  if (minute === null) return [];
  if (backedOff(inputs)) return [];
  const today = localDayFromDate(now);
  const written = writtenDays(inputs.entries);
  const out: Nudge[] = [];
  for (let i = 0; i < daysAhead; i++) {
    const day = addDays(today, i);
    if (engagement.nudge.pausedUntil && day <= engagement.nudge.pausedUntil) continue;
    if (engagement.nudge.skipDay === day) continue;
    if (engagement.nudge.frequency === 'weekly' && weekday(day) !== inputs.reviewDay) continue;
    if (written.has(day)) continue;
    const at = atMinutes(day, minute);
    if (at <= now.getTime()) continue;
    const picked = pickNudge(inputs, day, minute);
    out.push({ id: `nudge:${day}`, day, at, ...picked });
  }
  return out;
}

// ---------- fading ----------

/** The plan to save: setAt is kept unless the moment or its time changed, so moving the time restarts the three weeks. */
export function withSetAt(next: WritingPlan, previous: WritingPlan | null, now: Date = new Date()): WritingPlan {
  const same = !!previous && previous.moment === next.moment && previous.usualTime === next.usualTime;
  return { ...next, setAt: same && previous?.setAt ? previous.setAt : now.toISOString() };
}

/**
 * True when, in each of the last three full weeks, the person wrote before the
 * nudge was due on at least as many days as their rhythm (three with none):
 * the moment in their day may be doing the work, so the nudge can step back.
 * Only weeks that began after the writing time was set count.
 */
export function readyToFade(inputs: Pick<NudgeInputs, 'engagement' | 'entries' | 'now' | 'weekStartsOn'>): boolean {
  const { engagement } = inputs;
  if (!engagement.plan || !engagement.nudge.enabled || engagement.nudge.frequency !== 'daily') return false;
  const offered = engagement.nudge.fadeOfferedAt ? new Date(engagement.nudge.fadeOfferedAt).getTime() : 0;
  if (inputs.now.getTime() - offered < 56 * DAY_MS) return false;
  const minute = nudgeMinute(engagement);
  if (minute === null) return false;
  const target = engagement.rhythm ?? 3;
  const today = localDayFromDate(inputs.now);
  const thisWeek = weekStart(today, inputs.weekStartsOn);
  if (!engagement.plan.setAt || localDayFromDate(new Date(engagement.plan.setAt)) > addDays(thisWeek, -21)) return false;
  for (let w = 1; w <= 3; w++) {
    const start = addDays(thisWeek, -7 * w);
    let days = 0;
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      const due = atMinutes(day, minute);
      if (inputs.entries.some((e) => e.localDay === day && e.words > 0 && e.createdAt < due)) days++;
    }
    if (days < target) return false;
  }
  return true;
}

// ---------- follow-through, for the person's own figures ----------

/** Shown nudges followed by writing within two hours, and those never acted on that day. */
export function nudgeFollowThrough(fired: { day: LocalDay; at: number }[], entries: EntryFact[]): { shown: number; within2h: number; ignored: number } {
  let within2h = 0;
  let ignored = 0;
  for (const f of fired) {
    const soon = entries.some((e) => e.localDay === f.day && e.words > 0 && e.createdAt >= f.at - 60000 && e.createdAt <= f.at + 2 * 3600000);
    if (soon) within2h++;
    if (!actedOn(f, entries)) ignored++;
  }
  return { shown: fired.length, within2h, ignored };
}
