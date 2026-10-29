// Engagement checks run with `npm test`: the nudge's rules, the weekly rhythm,
// today's question, "Was this worth your time?", the fade offer, the calendar
// file and the tester summary. The rules are pure, so most checks need no
// database; the figures run against a real Dexie database on fake-indexeddb.
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { writingTimeIcs } from '../lib/calendar-export';
import { DAILY_QUESTIONS, GENTLE_QUESTIONS, questionFor, questionPromptId } from '../lib/daily-question';
import { DEFAULT_SETTINGS, getDB, loadSettings, saveSettings } from '../lib/db';
import { worthCandidate } from '../lib/engagement';
import { pickStarter, valuedBonus, type GuidanceContext, type RecentEntry } from '../lib/guidance';
import {
  backedOff,
  inQuietHours,
  nudgeFollowThrough,
  nudgeMinute,
  pickNudge,
  planNudges,
  readyToFade,
  withSetAt,
  type EntryFact,
  type Nudge,
  type NudgeInputs,
} from '../lib/nudge';
import * as copy from '../lib/nudge-copy';
import { rhythmLine, rhythmWeek, weekStart, weeksKept } from '../lib/rhythm';
import { seedDatabase } from '../lib/seed';
import { computeFigures, habitCheckDue, usageSummary } from '../lib/stats';
import { getTechnique } from '../lib/techniques';
import type { EngagementSettings, LocalDay, TechniqueId } from '../lib/types';
import { addDays } from '../lib/util';

let failures = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${(e as Error).message.split('\n').join('\n       ')}`);
  }
}

// Thursday 29 October 2026. Weeks start on Monday (26 October); the weekly
// chapter is on Sunday (1 November), as in the default settings.
const TODAY: LocalDay = '2026-10-29';

function at(day: LocalDay, time = '12:00'): Date {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi);
}
const ms = (day: LocalDay, time: string) => at(day, time).getTime();

type EngagementOver = Partial<Omit<EngagementSettings, 'nudge'>> & { nudge?: Partial<EngagementSettings['nudge']> };
function engagement(over: EngagementOver = {}): EngagementSettings {
  const base = structuredClone(DEFAULT_SETTINGS.engagement);
  const { nudge, ...rest } = over;
  return {
    ...base,
    plan: { moment: 'after dinner', usualTime: '19:30', place: 'at the kitchen table', setAt: at('2026-09-01').toISOString() },
    ...rest,
    nudge: { ...base.nudge, ...(nudge ?? {}) },
  };
}

function fact(day: LocalDay, time = '09:00', extra: Partial<EntryFact> = {}): EntryFact {
  const t = ms(day, time);
  return { id: `e-${day}-${time}`, localDay: day, createdAt: t, updatedAt: t + 10 * 60000, words: 120, complete: true, circled: false, nextQuestion: null, promptId: null, ...extra };
}

function inputs(over: Partial<NudgeInputs> = {}): NudgeInputs {
  return { now: at(TODAY, '12:00'), engagement: engagement(), reviewDay: 0, weekStartsOn: 1, avoidTopics: [], entries: [], fired: [], openForecasts: [], eventsThatMatter: [], ...over };
}

const NUDGE_AT = 20 * 60 + 30; // 19:30 plus an hour
const QUIET = DEFAULT_SETTINGS.engagement.quietHours;

async function main() {
  console.log('engagement: the nudge');

  await check('the nudge comes an hour after the moment, and never in quiet hours', () => {
    assert.equal(nudgeMinute(engagement()), NUDGE_AT);
    // 21:30 plus an hour lands in quiet hours (from 22:00), so it goes just before.
    assert.equal(nudgeMinute(engagement({ plan: { moment: 'before bed', usualTime: '21:30', place: '' } })), 21 * 60 + 59);
    // A moment inside quiet hours gets no nudge at all.
    assert.equal(nudgeMinute(engagement({ plan: { moment: 'late', usualTime: '22:30', place: '' } })), null);
    assert.equal(nudgeMinute(engagement({ plan: { moment: 'before bed', usualTime: '21:30', place: '' }, quietHours: { ...QUIET, enabled: false } })), 22 * 60 + 30);
    assert.equal(nudgeMinute(engagement({ plan: null })), null);
    // Quiet hours run over midnight.
    assert.equal(inQuietHours(23 * 60, QUIET), true);
    assert.equal(inQuietHours(3 * 60, QUIET), true);
    assert.equal(inQuietHours(7 * 60, QUIET), false);
    assert.equal(inQuietHours(21 * 60 + 59, QUIET), false);
  });

  await check('one nudge a day at most, only on days without writing', () => {
    const week = planNudges(inputs());
    assert.equal(week.length, 7);
    assert.equal(new Set(week.map((n) => n.day)).size, 7);
    for (const n of week) {
      assert.equal(n.id, `nudge:${n.day}`);
      const d = new Date(n.at);
      assert.equal(d.getHours() * 60 + d.getMinutes(), NUDGE_AT);
    }
    // Written today: nothing today, the rest of the week unchanged.
    const wrote = planNudges(inputs({ entries: [fact(TODAY, '09:00')] }));
    assert.equal(wrote[0].day, addDays(TODAY, 1));
    assert.equal(wrote.length, 6);
    // Today's time has passed.
    assert.equal(planNudges(inputs({ now: at(TODAY, '21:00') }))[0].day, addDays(TODAY, 1));
  });

  await check('Not today, Pause and review-day-only are respected', () => {
    assert.ok(!planNudges(inputs({ engagement: engagement({ nudge: { skipDay: TODAY } }) })).some((n) => n.day === TODAY));
    const paused = planNudges(inputs({ engagement: engagement({ nudge: { pausedUntil: addDays(TODAY, 2) } }) }));
    assert.equal(paused[0].day, addDays(TODAY, 3));
    const weekly = planNudges(inputs({ engagement: engagement({ nudge: { frequency: 'weekly' } }) }));
    assert.deepEqual(
      weekly.map((n) => n.day),
      ['2026-11-01'],
    );
    assert.deepEqual(planNudges(inputs({ engagement: engagement({ nudge: { enabled: false } }) })), []);
    assert.deepEqual(planNudges(inputs({ engagement: engagement({ plan: null }) })), []);
  });

  console.log('engagement: what the nudge says');
  const FRI: LocalDay = '2026-10-30';

  await check("today's question by default; plain text with it switched off", () => {
    const n = pickNudge(inputs(), FRI, NUDGE_AT);
    assert.equal(n.kind, 'question');
    assert.equal(n.text.body, questionFor(FRI)!.question.text);
    // The question is the same for everyone that day, so a locked journal may show it.
    assert.deepEqual(n.lockedText, n.text);
    const off = pickNudge(inputs({ engagement: engagement({ todaysQuestion: false }) }), FRI, NUDGE_AT);
    assert.equal(off.kind, 'plain');
    assert.deepEqual(off.text, copy.NUDGE_PLAIN);
  });

  await check('priority: week, then reality check, then an event that mattered, then the next question', () => {
    const next = fact('2026-10-28', '09:00', { nextQuestion: 'How did the talk go?' });
    const event = { day: TODAY, endMinute: null, title: 'Leadership presentation' };
    const forecast = { targetDate: FRI };
    assert.equal(pickNudge(inputs({ entries: [next] }), FRI, NUDGE_AT).kind, 'next-question');
    assert.equal(pickNudge(inputs({ entries: [next], eventsThatMatter: [event] }), FRI, NUDGE_AT).kind, 'after-event');
    assert.equal(pickNudge(inputs({ entries: [next], eventsThatMatter: [event], openForecasts: [forecast] }), FRI, NUDGE_AT).kind, 'reality-check');
    // Sunday is the review day: the week's chapter comes first.
    const week = pickNudge(inputs({ entries: [next, fact('2026-10-26')], eventsThatMatter: [event], openForecasts: [{ targetDate: '2026-11-01' }] }), '2026-11-01', NUDGE_AT);
    assert.equal(week.kind, 'week');
    assert.equal(week.text.body, '2 entries this week. Your chapter is ready to read.');
  });

  await check('an event later today waits until it has ended; an old forecast does not count', () => {
    const later = { day: FRI, endMinute: NUDGE_AT + 30, title: 'Dinner' };
    assert.notEqual(pickNudge(inputs({ eventsThatMatter: [later] }), FRI, NUDGE_AT).kind, 'after-event');
    assert.equal(pickNudge(inputs({ eventsThatMatter: [{ ...later, endMinute: NUDGE_AT - 30 }] }), FRI, NUDGE_AT).kind, 'after-event');
    assert.notEqual(pickNudge(inputs({ openForecasts: [{ targetDate: addDays(FRI, -8) }] }), FRI, NUDGE_AT).kind, 'reality-check');
  });

  await check('a question already picked up is not offered again', () => {
    const next = fact('2026-10-28', '09:00', { nextQuestion: 'How did the talk go?' });
    const draft = fact(TODAY, '08:00', { complete: false });
    assert.equal(pickNudge(inputs({ entries: [next, draft] }), FRI, NUDGE_AT).kind, 'question');
  });

  await check('after an entry that circled, nothing reopens a topic', () => {
    const circled = fact('2026-10-28', '09:00', { circled: true, nextQuestion: 'Why does this keep happening?' });
    const busy = inputs({ entries: [circled], eventsThatMatter: [{ day: TODAY, endMinute: null, title: 'Review' }], openForecasts: [{ targetDate: FRI }] });
    const n = pickNudge(busy, FRI, NUDGE_AT);
    assert.equal(n.kind, 'question');
    assert.ok(GENTLE_QUESTIONS.some((q) => q.text === n.text.body), 'a gentle question');
    assert.deepEqual(n.lockedText, copy.NUDGE_LOCKED);
    const off = pickNudge({ ...busy, engagement: engagement({ todaysQuestion: false }) }, FRI, NUDGE_AT);
    assert.equal(off.kind, 'neutral');
    assert.deepEqual(off.text, copy.NUDGE_NEUTRAL);
  });

  await check('no nudge ever carries entry text; event names only when switched on, and never when locked', () => {
    const SECRET = 'SECRET-';
    const entries = [fact('2026-10-27', '09:00', { nextQuestion: `${SECRET}next question` }), fact('2026-10-28', '09:00', { nextQuestion: `${SECRET}another` })];
    const events = [-1, 0, 1, 2, 3, 4, 5, 6].map((i) => ({ day: addDays(TODAY, i), endMinute: null, title: `${SECRET}event` }));
    const all: Nudge[] = [];
    for (const showEventNames of [false, true]) {
      for (const circled of [false, true]) {
        const base = inputs({ entries: entries.map((e) => ({ ...e, circled })), eventsThatMatter: events, openForecasts: [{ targetDate: addDays(TODAY, 3) }], engagement: engagement({ nudge: { showEventNames } }) });
        const planned = planNudges(base, 14);
        assert.ok(planned.length > 0);
        for (const n of planned) {
          all.push(n);
          assert.ok(!JSON.stringify(n.lockedText).includes(SECRET), `locked text of ${n.id}`);
          if (!showEventNames) assert.ok(!JSON.stringify(n.text).includes(SECRET), `text of ${n.id}`);
          else if (n.kind !== 'after-event') assert.ok(!JSON.stringify(n.text).includes(SECRET), `text of ${n.id}`);
        }
      }
    }
    // Locked text is either the fixed line or today's public question.
    const publicQuestions = new Set(DAILY_QUESTIONS.map((q) => q.text));
    for (const n of all) assert.ok(n.lockedText === copy.NUDGE_LOCKED || publicQuestions.has(n.lockedText.body), `locked text of ${n.id}: ${n.lockedText.body}`);
    assert.ok(all.some((n) => n.kind === 'after-event'));
  });

  console.log('engagement: stepping back');
  const fired = (day: LocalDay) => ({ day, at: ms(day, '20:30') });

  await check('three ignored nudges in a row stop the nudge', () => {
    const run = [fired('2026-10-26'), fired('2026-10-27'), fired('2026-10-28')];
    assert.equal(backedOff(inputs({ fired: run })), true);
    assert.deepEqual(planNudges(inputs({ fired: run })), []);
    // Writing after one of them breaks the run.
    assert.equal(backedOff(inputs({ fired: run, entries: [fact('2026-10-27', '20:45')] })), false);
    // A nudge shown today can still be acted on, so it is not counted yet.
    assert.equal(backedOff(inputs({ fired: [fired('2026-10-27'), fired('2026-10-28'), fired(TODAY)], now: at(TODAY, '21:00') })), false);
  });

  await check('after answering the offer, it takes three more ignored nudges, not one', () => {
    const run = [fired('2026-10-26'), fired('2026-10-27'), fired('2026-10-28')];
    const answered = engagement({ nudge: { backoffAnsweredAt: at('2026-10-28', '22:00').toISOString() } });
    assert.equal(backedOff(inputs({ fired: run, engagement: answered })), false);
    assert.equal(backedOff(inputs({ fired: [...run, fired(TODAY)], engagement: answered, now: at('2026-10-30', '12:00') })), false);
    assert.equal(backedOff(inputs({ fired: [...run, fired(TODAY), fired('2026-10-30'), fired('2026-10-31')], engagement: answered, now: at('2026-11-01', '12:00') })), true);
  });

  await check('follow-through counts writing within two hours of a nudge', () => {
    const shown = [fired('2026-10-26'), fired('2026-10-27'), fired('2026-10-28')];
    const entries = [fact('2026-10-26', '21:00'), fact('2026-10-27', '23:30')];
    assert.deepEqual(nudgeFollowThrough(shown, entries), { shown: 3, within2h: 1, ignored: 1 });
  });

  await check('the fade offer comes after three full weeks of writing before the nudge', () => {
    // The full weeks before this one start on 5, 12 and 19 October.
    const weeks = ['2026-10-05', '2026-10-12', '2026-10-19'];
    const three = weeks.flatMap((w) => [0, 2, 4].map((i) => fact(addDays(w, i), '08:00')));
    const base = { entries: three };
    assert.equal(readyToFade(inputs(base)), true);
    // One week with two days is not enough.
    assert.equal(readyToFade(inputs({ entries: three.slice(1) })), false);
    // Writing after the nudge was due doesn't count.
    assert.equal(readyToFade(inputs({ entries: weeks.flatMap((w) => [0, 2, 4].map((i) => fact(addDays(w, i), '21:00'))) })), false);
    // A weekly aim of five needs five.
    assert.equal(readyToFade(inputs({ ...base, engagement: engagement({ rhythm: 5 }) })), false);
    // Offered recently, or nudging only on the review day already.
    assert.equal(readyToFade(inputs({ ...base, engagement: engagement({ nudge: { fadeOfferedAt: at('2026-10-01').toISOString() } }) })), false);
    assert.equal(readyToFade(inputs({ ...base, engagement: engagement({ nudge: { fadeOfferedAt: at('2026-08-01').toISOString() } }) })), true);
    assert.equal(readyToFade(inputs({ ...base, engagement: engagement({ nudge: { frequency: 'weekly' } }) })), false);
  });

  await check('the fade offer only counts weeks the writing time was in place', () => {
    const weeks = ['2026-10-05', '2026-10-12', '2026-10-19'];
    const entries = weeks.flatMap((w) => [0, 2, 4].map((i) => fact(addDays(w, i), '08:00')));
    const planFrom = (day: LocalDay | null) => engagement({ plan: { moment: 'after dinner', usualTime: '19:30', place: '', ...(day ? { setAt: at(day, '09:00').toISOString() } : {}) } });
    assert.equal(readyToFade(inputs({ entries, engagement: planFrom('2026-10-05') })), true);
    assert.equal(readyToFade(inputs({ entries, engagement: planFrom('2026-10-06') })), false);
    assert.equal(readyToFade(inputs({ entries, engagement: planFrom(null) })), false);
    // Moving the time restarts the three weeks; changing only the place does not.
    const before = { moment: 'after dinner', usualTime: '19:30', place: '', setAt: at('2026-09-01').toISOString() };
    const now = at(TODAY);
    assert.equal(withSetAt({ ...before, place: 'on the sofa' }, before, now).setAt, before.setAt);
    assert.equal(withSetAt({ ...before, usualTime: '20:00' }, before, now).setAt, now.toISOString());
    assert.equal(withSetAt(before, null, now).setAt, now.toISOString());
  });

  console.log('engagement: the weekly rhythm');

  await check('only this week shows, and a new week starts clean', () => {
    const lastWeek = Array.from({ length: 7 }, (_, i) => addDays('2026-10-19', i));
    const monday = rhythmWeek(lastWeek, '2026-10-26', 1, 3);
    assert.equal(monday.count, 0);
    assert.equal(monday.days.length, 7);
    assert.equal(monday.days[0].day, '2026-10-26');
    assert.equal(rhythmLine(monday), '0 of 3 days this week');
  });

  await check('week boundaries follow the chosen first day', () => {
    assert.equal(weekStart(TODAY, 1), '2026-10-26');
    assert.equal(weekStart(TODAY, 0), '2026-10-25');
    assert.equal(weekStart('2026-10-26', 1), '2026-10-26');
    assert.equal(weekStart('2026-11-01', 1), '2026-10-26');
    // A Sunday counts for the week starting on Sunday, not the one starting on Monday.
    assert.equal(rhythmWeek(['2026-10-25'], TODAY, 1, 3).count, 0);
    assert.equal(rhythmWeek(['2026-10-25'], TODAY, 0, 3).count, 1);
    const w = rhythmWeek(['2026-10-26', '2026-10-28'], TODAY, 1, 3);
    assert.deepEqual(
      w.days.map((d) => [d.wrote, d.isToday, d.isFuture]),
      [
        [true, false, false],
        [false, false, false],
        [true, false, false],
        [false, true, false],
        [false, false, true],
        [false, false, true],
        [false, false, true],
      ],
    );
  });

  await check('the rhythm line never counts a loss', () => {
    assert.equal(rhythmLine(rhythmWeek(['2026-10-26', '2026-10-28'], TODAY, 1, 3)), '2 of 3 days this week');
    assert.equal(rhythmLine(rhythmWeek(['2026-10-26', '2026-10-27', '2026-10-28'], TODAY, 1, 3)), 'Rhythm kept this week');
    assert.equal(rhythmLine(rhythmWeek(['2026-10-26', '2026-10-27', '2026-10-28', TODAY], TODAY, 1, 3)), 'Rhythm kept, 4 days this week');
    assert.equal(rhythmLine(rhythmWeek(['2026-10-26'], TODAY, 1, null)), '1 day this week');
    const lossWords = /miss|lost|lose|streak|broke|break|reset|behind|fail|only/i;
    const week = Array.from({ length: 7 }, (_, i) => addDays('2026-10-26', i));
    for (const target of [null, 3, 4, 5, 7]) {
      for (let n = 0; n <= 7; n++) {
        const line = rhythmLine(rhythmWeek(week.slice(0, n), '2026-11-01', 1, target));
        assert.ok(!lossWords.test(line), `"${line}"`);
      }
    }
    // The figures count kept weeks, never missed ones.
    assert.equal(weeksKept([...week.slice(0, 3), '2026-10-19'], '2026-10-01', '2026-11-01', 1, 3), 1);
  });

  console.log("engagement: today's question");

  await check('the same question for everyone on a date, changing daily', () => {
    assert.deepEqual(questionFor(TODAY), questionFor(TODAY));
    assert.notEqual(questionFor(TODAY)!.question.id, questionFor(addDays(TODAY, 1))!.question.id);
    assert.equal(questionFor(TODAY)!.question.id, questionFor(addDays(TODAY, DAILY_QUESTIONS.length))!.question.id);
    assert.equal(questionPromptId(TODAY), 'today:2026-10-29');
    const ids = [...DAILY_QUESTIONS, ...GENTLE_QUESTIONS].map((q) => q.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  await check('a gentler question replaces one that touches a topic to leave alone', () => {
    let day = TODAY;
    while (questionFor(day)!.question.id !== 'dq26') day = addDays(day, 1);
    const pick = questionFor(day, ['work'])!;
    assert.equal(pick.gentle, true);
    assert.ok(GENTLE_QUESTIONS.includes(pick.question));
    assert.ok(!/\bwork/i.test(pick.question.text));
    // After an entry that circled, always a gentle one.
    assert.ok(GENTLE_QUESTIONS.includes(questionFor(TODAY, [], true)!.question));
    // If every candidate touches a topic to leave alone, no question at all.
    while (!questionFor(day)!.question.text.startsWith('What')) day = addDays(day, 1);
    assert.equal(questionFor(day, ['what']), null);
  });

  await check('questions stay light: no clinical words, no dashes', () => {
    const clinical = /depress|anxi|symptom|trauma|diagnos|disorder|therap|suicid|harm|panic|illness|medicat|grief|abuse/i;
    for (const q of [...DAILY_QUESTIONS, ...GENTLE_QUESTIONS]) {
      assert.ok(!clinical.test(q.text), q.text);
      assert.ok(!/[–—]/.test(q.text), q.text);
      assert.ok(q.text.endsWith('?'), q.text);
    }
  });

  await check('nudge wording names what is waiting, never what was lost', () => {
    const texts = [
      copy.NUDGE_LOCKED,
      copy.NUDGE_PLAIN,
      copy.NUDGE_NEUTRAL,
      copy.NUDGE_REALITY_CHECK,
      copy.NUDGE_NEXT_QUESTION,
      copy.NUDGE_BACKOFF_OFFER,
      copy.NUDGE_FADE_OFFER,
      copy.nudgeQuestion('What went right today?'),
      copy.nudgeAfterEvent(null),
      copy.nudgeAfterEvent('the review'),
      copy.nudgeWeek(1),
      copy.nudgeWeek(4),
    ].flatMap((t) => [t.title, t.body]);
    for (const t of texts) {
      assert.ok(!/streak|lose|lost|miss|don't break|noticed|we've|worried/i.test(t), t);
      assert.ok(!/[–—]/.test(t), t);
    }
  });

  console.log('engagement: "Was this worth your time?"');
  type W = Parameters<typeof worthCandidate>[0][number];
  const done = (id: string, day: LocalDay, time: string, extra: Partial<W> = {}): W => ({ id, status: 'complete', localDay: day, updatedAt: at(day, time).toISOString(), worth: null, worthSkipped: false, ...extra });

  await check('asked at a later visit, not straight after writing', () => {
    const e = done('a', TODAY, '09:00');
    assert.equal(worthCandidate([e], at(TODAY, '11:00')), null);
    assert.equal(worthCandidate([e], at(TODAY, '12:30')), 'a');
    // Late last night counts as an earlier visit by the next day.
    assert.equal(worthCandidate([done('b', '2026-10-28', '23:00')], at(TODAY, '00:30')), 'b');
    // Too old to ask about.
    assert.equal(worthCandidate([done('c', '2026-10-21', '09:00')], at(TODAY, '12:00')), null);
    // A draft written since doesn't get in the way.
    assert.equal(worthCandidate([e, { ...done('d', TODAY, '12:00'), status: 'draft' }], at(TODAY, '12:30')), 'a');
  });

  await check('one entry in five at most, and never twice', () => {
    const now = at(TODAY, '18:00');
    const series = (askedIndex: number | null) =>
      Array.from({ length: 6 }, (_, i) => done(`e${i}`, addDays(TODAY, -i), '09:00', i === askedIndex ? { worth: { score: 4, at: now.toISOString() } } : {}));
    assert.equal(worthCandidate(series(null), now), 'e0');
    assert.equal(worthCandidate(series(0), now), null);
    for (const i of [1, 2, 3, 4]) assert.equal(worthCandidate(series(i), now), null, `asked ${i} entries ago`);
    assert.equal(worthCandidate(series(5), now), 'e0');
    const skipped = series(null);
    skipped[2] = { ...skipped[2], worthSkipped: true };
    assert.equal(worthCandidate(skipped, now), null);
  });

  await check('ratings steer which exercise is offered', () => {
    const ctx = (recent: RecentEntry[]): GuidanceContext => {
      const s = structuredClone(DEFAULT_SETTINGS);
      return {
        now: at(TODAY, '12:00'),
        today: TODAY,
        // The programme exercises come first in a fixed order, so leave them out here.
        guidance: { ...s.guidance, level: 'deep', goals: ['calmer'], techniques: { next_chapter: false, strengths: false, your_story: false } },
        planner: s.planner,
        engagement: { todaysQuestion: true, nextTimeQuestion: true },
        values: [],
        recent,
        agenda: { events: [], tasks: [], forecasts: [] },
        threads: [],
        nodes: [],
        worries: [],
      };
    };
    const DAY = addDays(TODAY, -20);
    const used = (technique: TechniqueId, worth: number | null): RecentEntry => ({
      id: `r-${technique}`,
      localDay: DAY,
      status: 'complete',
      prompt: null,
      exercise: { technique, step: 3, startedAt: at(DAY).toISOString(), finishedAt: at(DAY).toISOString(), exitedAt: null, session: 1 },
      circled: false,
      nextQuestion: null,
      worth,
    });
    const first = pickStarter(ctx([])).offer;
    assert.ok(first, 'an exercise is offered at Deep');
    const a = first.technique;
    assert.ok(getTechnique(a).spacingDays < 20, `${a} can be offered again after 20 days`);
    // Rated worth it: offered again, and the reason says why.
    const liked = pickStarter(ctx([used(a, 5)])).offer;
    assert.equal(liked?.technique, a);
    assert.equal(liked?.reason, 'You found this worth your time before.');
    // Rated not worth it: something else comes first.
    assert.notEqual(pickStarter(ctx([used(a, 1)])).offer?.technique, a);
    // Middling ratings, or none, change nothing.
    assert.equal(valuedBonus([used(a, 3)], a), 0);
    assert.equal(valuedBonus([used(a, null)], a), 0);
    assert.equal(valuedBonus([used(a, 4), used(a, 5)], a), 1);
    assert.equal(valuedBonus([used(a, 2), used(a, 1)], a), -2);
  });

  console.log('engagement: the calendar file');

  await check('a neutral, repeating event in floating local time', () => {
    const plan = { moment: 'after dinner', usualTime: '19:30', place: 'at the kitchen table' };
    const ics = writingTimeIcs(plan, { from: TODAY, now: new Date(Date.UTC(2026, 9, 29, 12, 0, 0)), uid: 'writing-time-test@neuroreflect.app' });
    assert.ok(ics.endsWith('\r\n'));
    assert.ok(!/[^\r]\n/.test(ics), 'every line ends in CRLF');
    const lines = ics.trimEnd().split('\r\n');
    assert.equal(lines[0], 'BEGIN:VCALENDAR');
    assert.equal(lines.at(-1), 'END:VCALENDAR');
    for (const l of ['VERSION:2.0', 'DTSTART:20261029T193000', 'DTSTAMP:20261029T120000Z', 'DURATION:PT15M', 'RRULE:FREQ=DAILY', 'SUMMARY:Writing time', 'BEGIN:VALARM', 'TRIGGER:PT0M', 'UID:writing-time-test@neuroreflect.app']) {
      assert.ok(lines.includes(l), l);
    }
    for (const l of lines) assert.ok(Buffer.byteLength(l) <= 75, `line too long: ${l}`);
    // Shared work calendars show the title, so nothing personal goes in.
    assert.ok(!/dinner|kitchen/i.test(ics));
  });

  console.log('engagement: figures and the tester summary');

  await check('the usage summary holds counts and settings only', async () => {
    await seedDatabase();
    let settings = await saveSettings({
      userName: 'Callum',
      engagement: {
        tester: true,
        rhythm: 3,
        plan: { moment: 'after dinner', usualTime: '19:30', place: 'at the kitchen table', setAt: new Date().toISOString() },
        habitChecks: [{ at: new Date().toISOString(), score: 4.25 }],
      },
    });
    const now = new Date();
    await getDB().reminderLog.put({ id: `nudge:${addDays(TODAY, -1)}`, firedAt: at(addDays(TODAY, -1), '20:30').toISOString() });
    settings = await loadSettings();
    const figures = await computeFigures(settings, now);
    assert.ok(figures.entries > 0);
    assert.ok(figures.weeksSinceStart >= 1 && figures.weeksSinceStart <= 8);
    assert.ok(figures.weeksWrittenOf8 <= figures.weeksSinceStart);
    const summary = usageSummary(figures, settings, '0.1.0');
    const json = JSON.stringify(summary);

    // No dates or times.
    assert.ok(!/\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}/.test(json), 'no dates');
    // Nothing anyone wrote or planned.
    const db = getDB();
    const [entries, events, tasks] = await Promise.all([db.entries.toArray(), db.events.toArray(), db.tasks.toArray()]);
    const words = [...entries.map((e) => e.title), ...events.map((e) => e.title), ...tasks.map((t) => t.title), 'Callum', 'after dinner', 'kitchen table'].filter((t) => t && t.length > 3);
    for (const w of words) assert.ok(!json.includes(w), `found "${w}"`);
    // Every text value is a label from a short fixed list.
    const allowed = new Set(['neuroreflect-usage-summary', '0.1.0', 'blank', 'open', 'guided', 'deep', 'daily', 'weekly', 'built-in', 'ai']);
    const walk = (v: unknown, path: string) => {
      if (typeof v === 'string') assert.ok(allowed.has(v), `${path} = "${v}"`);
      else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
      else assert.ok(v === null || typeof v === 'number' || typeof v === 'boolean', `${path} is ${typeof v}`);
    };
    walk(summary, 'summary');
    assert.deepEqual(summary.habitCheckScores, [4.25]);
  });

  await check('the habit check comes every four weeks, for testers with a writing time', async () => {
    const s = await loadSettings();
    const now = new Date(s.engagement.habitChecks[0].at);
    assert.equal(habitCheckDue(s, now), false);
    assert.equal(habitCheckDue(s, new Date(now.getTime() + 27 * 86400000)), false);
    assert.equal(habitCheckDue(s, new Date(now.getTime() + 28 * 86400000)), true);
    assert.equal(habitCheckDue({ ...s, engagement: { ...s.engagement, tester: false } }, new Date(now.getTime() + 60 * 86400000)), false);
    assert.equal(habitCheckDue({ ...s, engagement: { ...s.engagement, habitChecks: [] } }, now), true);
  });

  console.log(failures ? `\n${failures} engagement check(s) failed` : '\nAll engagement checks passed');
  if (failures) process.exit(1);
}

void main();
