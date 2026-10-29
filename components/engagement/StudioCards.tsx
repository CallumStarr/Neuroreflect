'use client';

import { useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDB, saveSettings } from '@/lib/db';
import { FIRST_CHAPTER_ENTRIES, loadNudgeInputs, rateEntry, skipWorth, worthCandidate } from '@/lib/engagement';
import { backedOff, readyToFade } from '@/lib/nudge';
import { NUDGE_BACKOFF_OFFER, NUDGE_FADE_OFFER } from '@/lib/nudge-copy';
import { weekStart } from '@/lib/rhythm';
import { habitCheckDue } from '@/lib/stats';
import { useUI } from '@/lib/store';
import type { Entry } from '@/lib/types';
import { addDays, formatDay, localDayOf } from '@/lib/util';
import { HabitCheckDialog, WritingTimeDialog } from './Dialogs';

function Card({ title, children, actions, testId }: { title: string; children?: ReactNode; actions: ReactNode; testId: string }) {
  return (
    <section className="nr-rise mb-5 rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3.5" data-testid={testId} aria-label={title}>
      <p className="text-[13.5px] font-medium text-paper-50">{title}</p>
      {children && <div className="mt-1 text-[12.5px] leading-5 text-paper-300">{children}</div>}
      <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>
    </section>
  );
}

const primary = 'rounded-lg bg-ember-400 px-3 py-1.5 text-[12.5px] font-medium text-ink-950 hover:bg-ember-300';
const quiet = 'rounded-lg border border-ink-700 px-3 py-1.5 text-[12.5px] text-paper-100 hover:bg-ink-900';
const link = 'px-1 text-[12.5px] text-paper-500 underline decoration-ink-600 underline-offset-2 hover:text-paper-100';

type CardId = 'backoff' | 'fade' | 'worth' | 'first-session' | 'week' | 'habit' | 'intro';

/**
 * One card at a time above a fresh entry, most useful first: an offer about
 * the nudge, "Was this worth your time?" about an earlier entry, the first
 * session's last step, the week's chapter, the habit check, or setting a
 * writing time. Each asks once and is easy to wave away.
 */
export default function StudioCards({ entry, fresh, onOpenWeek, onForecast }: { entry: Entry; fresh: boolean; onOpenWeek: () => void; onForecast: () => void }) {
  const { settings, setSettings } = useUI();
  const e = settings.engagement;
  const [dialog, setDialog] = useState<'time' | 'time-backoff' | 'habit' | null>(null);
  const now = new Date();
  const today = localDayOf(now);

  const data = useLiveQuery(async () => {
    const db = getDB();
    const [inputs, recent, completeCount, forecastCount] = await Promise.all([
      loadNudgeInputs(settings),
      db.entries.where('localDay').aboveOrEqual(addDays(today, -30)).toArray(),
      db.entries.where('status').equals('complete').count(),
      db.forecasts.count(),
    ]);
    return { inputs, recent, completeCount, forecastCount };
  }, [settings, today]);
  if (!data) return null;

  const seen = (id: string) => e.seen.includes(id);
  const markSeen = async (id: string) => setSettings(await saveSettings({ engagement: { seen: [...new Set([...e.seen, id])] } }));
  const patchNudge = async (patch: Partial<typeof e.nudge>) => setSettings(await saveSettings({ engagement: { nudge: patch } }));

  const thisWeek = weekStart(today, settings.planner.weekStartsOn);
  const weekEntries = data.recent.filter((x) => x.localDay >= thisWeek && x.wordCount > 0).length;
  const reviewDay = now.getDay() === settings.planner.weeklyReviewDay;
  const worthId = e.valuedEntries ? worthCandidate(data.recent, now, today) : null;
  const worthEntry = worthId ? data.recent.find((x) => x.id === worthId) : null;
  const firstSession = entry.status === 'complete' && data.completeCount === 1 && data.forecastCount === 0 && !seen('first-forecast');

  let card: CardId | null = null;
  if (firstSession) card = 'first-session';
  else if (fresh) {
    if (e.plan && e.nudge.enabled && backedOff(data.inputs)) card = 'backoff';
    else if (readyToFade(data.inputs)) card = 'fade';
    else if (worthEntry) card = 'worth';
    else if ((reviewDay && weekEntries > 0 && !seen(`week:${thisWeek}`)) || (data.completeCount === FIRST_CHAPTER_ENTRIES && !seen('first-chapter'))) card = 'week';
    else if (habitCheckDue(settings, now) && !seen(`habit-later:${thisWeek}`)) card = 'habit';
    else if (!e.plan && e.welcomeDone && !seen('writing-time-intro')) card = 'intro';
  }

  const dialogs = (
    <>
      {dialog === 'time' && <WritingTimeDialog onClose={() => setDialog(null)} />}
      {dialog === 'time-backoff' && <WritingTimeDialog answeringBackoff onClose={() => setDialog(null)} />}
      {dialog === 'habit' && <HabitCheckDialog onClose={() => setDialog(null)} />}
    </>
  );
  if (!card) return dialogs;

  const stamp = new Date().toISOString();
  let body: ReactNode = null;
  switch (card) {
    case 'backoff':
      body = (
        <Card
          testId="card-backoff"
          title={NUDGE_BACKOFF_OFFER.title}
          actions={
            <>
              <button type="button" className={primary} onClick={() => setDialog('time-backoff')}>
                Move it
              </button>
              <button type="button" className={quiet} onClick={() => void patchNudge({ pausedUntil: addDays(today, 6), backoffAnsweredAt: stamp })}>
                Pause for a week
              </button>
              <button type="button" className={link} onClick={() => void patchNudge({ backoffAnsweredAt: stamp })}>
                Keep it as it is
              </button>
            </>
          }
        >
          {NUDGE_BACKOFF_OFFER.body}
        </Card>
      );
      break;
    case 'fade':
      body = (
        <Card
          testId="card-fade"
          title={NUDGE_FADE_OFFER.title}
          actions={
            <>
              <button type="button" className={primary} onClick={() => void patchNudge({ enabled: false, fadeOfferedAt: stamp })}>
                Switch the nudge off
              </button>
              <button type="button" className={quiet} onClick={() => void patchNudge({ frequency: 'weekly', fadeOfferedAt: stamp })}>
                Review day only
              </button>
              <button type="button" className={link} onClick={() => void patchNudge({ fadeOfferedAt: stamp })}>
                Keep it daily
              </button>
            </>
          }
        >
          {NUDGE_FADE_OFFER.body}
        </Card>
      );
      break;
    case 'worth':
      body = (
        <Card
          testId="card-worth"
          title={`Looking back at your entry from ${worthEntry!.localDay === today ? 'earlier today' : formatDay(worthEntry!.localDay, { weekday: 'long' })}: was it worth your time?`}
          actions={
            <>
              <span className="text-[11.5px] text-paper-500">Not really</span>
              {([1, 2, 3, 4, 5] as const).map((n) => (
                <button key={n} type="button" onClick={() => void rateEntry(worthEntry!.id, n)} aria-label={`${n} out of 5`} className="h-8 w-9 rounded-lg border border-ink-700 text-[13px] text-paper-100 hover:border-ember-400 hover:bg-ember-400/10">
                  {n}
                </button>
              ))}
              <span className="text-[11.5px] text-paper-500">Very much</span>
              <button type="button" className={link} onClick={() => void skipWorth(worthEntry!.id)}>
                Skip
              </button>
            </>
          }
        >
          {worthEntry!.title ? <span className="font-serif italic">{worthEntry!.title}. </span> : null}
          Asked a while after, because some writing feels harder at the time and helps later. Your answers stay on this device and help choose exercises that work for you.
        </Card>
      );
      break;
    case 'first-session':
      body = (
        <Card
          testId="card-first-session"
          title="Setup done. Two more entries to your first weekly chapter."
          actions={
            <>
              <button
                type="button"
                className={primary}
                onClick={() => {
                  void markSeen('first-forecast');
                  onForecast();
                }}
              >
                Forecast something
              </button>
              <button type="button" className={link} onClick={() => void markSeen('first-forecast')}>
                Not now
              </button>
            </>
          }
        >
          One more step, if you like: is something coming up in the next week? Say how you expect it to feel, and NeuroReflect will check with you afterwards how it went.
        </Card>
      );
      break;
    case 'week': {
      const first = data.completeCount === FIRST_CHAPTER_ENTRIES && !seen('first-chapter');
      const id = first ? 'first-chapter' : `week:${thisWeek}`;
      body = (
        <Card
          testId="card-week"
          title={first ? 'Your first weekly chapter is ready' : 'Your week is ready'}
          actions={
            <>
              <button
                type="button"
                className={primary}
                onClick={() => {
                  void markSeen(id);
                  onOpenWeek();
                }}
              >
                Read your week
              </button>
              <button type="button" className={link} onClick={() => void markSeen(id)}>
                Later
              </button>
            </>
          }
        >
          {weekEntries === 1 ? '1 entry this week.' : `${weekEntries} entries this week.`} Takeaways, plans and how things went, side by side.
        </Card>
      );
      break;
    }
    case 'habit':
      body = (
        <Card
          testId="card-habit"
          title="A 30-second habit check"
          actions={
            <>
              <button type="button" className={primary} onClick={() => setDialog('habit')}>
                Answer four questions
              </button>
              <button type="button" className={link} onClick={() => void markSeen(`habit-later:${thisWeek}`)}>
                Not this week
              </button>
            </>
          }
        >
          Every four weeks while you're testing: is writing becoming automatic? It shows whether the habit holds without the nudge.
        </Card>
      );
      break;
    case 'intro':
      body = (
        <Card
          testId="card-intro"
          title="Set a writing time?"
          actions={
            <>
              <button type="button" className={primary} onClick={() => setDialog('time')}>
                Choose a moment
              </button>
              <button type="button" className={link} onClick={() => void markSeen('writing-time-intro')}>
                Not now
              </button>
            </>
          }
        >
          Tie writing to a moment that already happens in your day, such as after dinner. If you haven't written by then, one gentle nudge an hour later, and never in quiet hours.
        </Card>
      );
      break;
  }
  return (
    <>
      {body}
      {dialogs}
    </>
  );
}
