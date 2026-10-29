// What the engagement features read from the journal: facts about entries,
// the nudges already shown, forecasts and planner events. Reading needs an
// unlocked journal, like everything else personal; the nudge's own times
// live in the reminder schedule, which a locked journal can still read.

import { getDB } from './db';
import { minutesOf, type EntryFact, type NudgeInputs } from './nudge';
import { occurrences } from './planner';
import type { AppSettings, Entry, LocalDay } from './types';
import { addDays, localDayOf } from './util';

const NUDGE_PREFIX = 'nudge:';

export async function loadEntryFacts(sinceDay?: LocalDay): Promise<EntryFact[]> {
  const db = getDB();
  const entries = sinceDay ? await db.entries.where('localDay').aboveOrEqual(sinceDay).toArray() : await db.entries.toArray();
  const telemetry = sinceDay ? await db.telemetry.where('localDay').aboveOrEqual(sinceDay).toArray() : await db.telemetry.toArray();
  const circled = new Set(telemetry.filter((t) => t.ruminationFlag).map((t) => t.entryId));
  return entries.map((e) => ({
    id: e.id,
    localDay: e.localDay,
    createdAt: new Date(e.createdAt).getTime(),
    updatedAt: new Date(e.updatedAt).getTime(),
    words: e.wordCount,
    complete: e.status === 'complete',
    circled: circled.has(e.id),
    nextQuestion: e.nextQuestion ?? null,
    promptId: e.prompt?.id ?? null,
  }));
}

/** Nudges shown so far, from the device-only reminder log. */
export async function loadFiredNudges(): Promise<{ day: LocalDay; at: number }[]> {
  const rows = await getDB().reminderLog.where('id').startsWith(NUDGE_PREFIX).toArray();
  return rows.map((r) => ({ day: r.id.slice(NUDGE_PREFIX.length, NUDGE_PREFIX.length + 10), at: new Date(r.firedAt).getTime() }));
}

export async function loadNudgeInputs(settings: AppSettings, now: Date = new Date()): Promise<NudgeInputs> {
  const db = getDB();
  const today = localDayOf(now);
  const since = addDays(today, -60);
  const [entries, fired, forecasts, events] = await Promise.all([loadEntryFacts(since), loadFiredNudges(), db.forecasts.toArray(), db.events.toArray()]);
  const eventsThatMatter: NudgeInputs['eventsThatMatter'] = [];
  for (const ev of events) {
    if (!ev.big && !ev.valueId) continue;
    for (const o of occurrences(ev, addDays(today, -2), addDays(today, 7))) {
      eventsThatMatter.push({ day: o.endDay, endMinute: o.endTime ? minutesOf(o.endTime) : o.startTime ? minutesOf(o.startTime) + 60 : null, title: ev.title });
    }
  }
  return {
    now,
    engagement: settings.engagement,
    reviewDay: settings.planner.weeklyReviewDay,
    weekStartsOn: settings.planner.weekStartsOn,
    avoidTopics: settings.guidance.avoidTopics,
    entries,
    fired,
    openForecasts: forecasts.filter((f) => !f.calibratedAt).map((f) => ({ targetDate: f.targetDate })),
    eventsThatMatter,
  };
}

// ---------- "Was this worth your time?" ----------

/** How long after finishing an entry the question may come, so it is asked at a later visit. */
export const WORTH_DELAY_MS = 3 * 3600000;
const WORTH_MAX_AGE_DAYS = 7;
/** At most one entry in five. */
export const WORTH_EVERY = 5;

/**
 * The entry to ask about, if any: the last finished one, finished at an
 * earlier visit, unrated, and with none of the four before it asked about.
 * Asking straight after an entry would rate how it felt in the moment, and
 * hard writing usually feels worse before it helps (Baikie & Wilhelm 2005).
 */
export function worthCandidate(entries: Pick<Entry, 'id' | 'status' | 'updatedAt' | 'localDay' | 'worth' | 'worthSkipped'>[], now: Date, today: LocalDay = localDayOf(now)): string | null {
  const done = entries.filter((e) => e.status === 'complete').sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const last = done[0];
  if (!last || last.worth || last.worthSkipped) return null;
  const finished = new Date(last.updatedAt).getTime();
  if (last.localDay === today && now.getTime() - finished < WORTH_DELAY_MS) return null;
  if (now.getTime() - finished > WORTH_MAX_AGE_DAYS * 86400000) return null;
  if (done.slice(1, WORTH_EVERY).some((e) => e.worth || e.worthSkipped)) return null;
  return last.id;
}

export async function rateEntry(id: string, score: 1 | 2 | 3 | 4 | 5): Promise<void> {
  await getDB().entries.update(id, { worth: { score, at: new Date().toISOString() } });
}

export async function skipWorth(id: string): Promise<void> {
  await getDB().entries.update(id, { worthSkipped: true });
}

// ---------- the first weekly chapter ----------

/** Setup counts as the first step; the first weekly chapter opens after three entries. */
export const FIRST_CHAPTER_ENTRIES = 3;
