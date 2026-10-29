// First-launch sample data: four entries over two weeks, three resolved
// forecasts, one forecast awaiting a reality check, and one high-rumination
// entry. All metrics are computed by the engine, never hard-coded.

import { DEFAULT_SETTINGS, getDB, loadSettings, saveSettings } from './db';
import { heuristicSynthesis } from './heuristic-copilot';
import { computeTelemetry, heuristicValueAlignment } from './psych-engine';
import { extractAndStoreMentions, rebuildGraph, saveTelemetry, storeAlignment } from './pipeline';
import { rebuildMemoryArtifacts } from './memory';
import { markAllMigrated } from './migrations';
import { newEvent } from './planner';
import type { CaptureNote, CopilotTurn, CoreValue, Entry, Forecast, PlanEvent, Task } from './types';
import { addDays, countWords, localDayOf, uid } from './util';

interface SeedEntry {
  offset: number;
  hour: number;
  title: string;
  paragraphs: string[];
  minutes: number;
  dictated?: boolean;
  turns?: { mode: CopilotTurn['mode']; text: string }[];
}

export const ENTRIES: SeedEntry[] = [
  {
    offset: -13,
    hour: 21,
    title: 'Before the leadership presentation',
    minutes: 14,
    paragraphs: [
      'Priya asked me to present the Q3 findings to the leadership group next Thursday. My first reaction was a hot rush in my face and the urge to say someone else should do it. I said yes anyway, which I am counting as a small win. #work',
      "I've been stressed all evening. If I'm honest it is closer to anticipatory dread than stress: a tight chest and a restless stomach whenever I picture the room. I always freeze when senior people ask questions, or at least that is the story I tell myself. Looking back, the last two times went fine.",
      'Part of the fear is that they will see I am still learning. But learning is the whole point of saying yes to this, and $growth matters more to me than looking polished.',
      'Plan: draft the slides tomorrow, run them past @Sam on Sunday, and finally book the dentist appointment I keep putting off.',
    ],
    turns: [
      { mode: 'socratic', text: 'When you picture the room, whose reaction are you most bracing for, and what do you imagine it would mean about you?' },
    ],
  },
  {
    offset: -9,
    hour: 22,
    title: 'It went better than my brain said it would',
    minutes: 11,
    paragraphs: [
      "The presentation happened. I was shaking for the first minute and then it settled. The finance director asked the question I'd dreaded most and I answered it, not perfectly, but well enough. @Priya caught me afterwards and said it was clear and calm.",
      "What I notice is how wrong my forecast was. I rated my dread at 80 and the reality was nearer 35. The anticipation was far worse than the event itself, which is worth remembering next time my mind is telling me I will fall apart.",
      '@Sam made pasta to celebrate and we laughed about how I had rehearsed to the cat. I felt real relief, and a quieter pride underneath it. #relationships $connection',
      "Next on the list: talking to @Mum about Christmas. We need to tell her we're going to Sam's family this year and I have been avoiding the call for two weeks.",
    ],
  },
  {
    offset: -5,
    hour: 23,
    title: 'Review meeting',
    minutes: 19,
    paragraphs: [
      'Today was awful. The review meeting went badly and I keep replaying it. Priya said my report was not ready and I just sat there. I am such a failure. I felt sick the whole afternoon.',
      'Everyone thinks I am useless now, I can see it on their faces. I hate how I freeze. I hate that I am still this person. Everything is ruined with this project. I wanted to cry in the toilets.',
      'I cancelled the gym. I scrolled on my phone until 2am and I did not want to think about any of it. I feel worthless and tired and stuck. My chest is tight. I am so angry with myself.',
      'I always mess things up when it matters. I keep going over every word I said and every face in the room. I feel stupid. I feel exhausted. I can not face another week like this. I just want to stop feeling like this.',
    ],
    turns: [
      {
        mode: 'distancing',
        text: 'Picture yourself twelve months from now reading this. How do you think that version of you will see this exact situation?',
      },
    ],
  },
  {
    offset: -2,
    hour: 20,
    title: 'Stepping back',
    minutes: 16,
    dictated: true,
    paragraphs: [
      'Wrote about the review meeting from the outside this morning, as if it had happened to someone else. That helped more than I expected. Seen from there, it was one critical comment about one report, from a manager who has backed me all month.',
      "I'm noticing the thought that I always mess things up. It shows up loudly when I'm tired, and it is a thought, not a verdict. The feedback was fair, although the delivery stung. What actually hurt was boundary resentment: I had told Priya the deadline was too tight and agreed anyway.",
      "Called @Mum about Christmas. She was disappointed for about a minute and then started asking what Sam's family eat on the day. I had built it up into something huge. #family $honesty",
      'Went for a run along the river and slept properly for the first time in a week. $health Tomorrow is the quarterly review, and I am going to ask for a realistic timeline on the next report instead of saying yes and resenting it. I feel a bit of apprehension, and some groundedness too.',
    ],
    turns: [
      { mode: 'socratic', text: 'What would saying no to an unrealistic deadline protect that saying yes keeps costing you?' },
    ],
  },
];

const VALUES: Omit<CoreValue, 'id'>[] = [
  { label: 'Growth', description: 'Learning, stretching beyond comfort, building skill', order: 0 },
  { label: 'Connection', description: 'Showing up for Sam, family and friends', order: 1 },
  { label: 'Honesty', description: 'Saying what I actually think, kindly', order: 2 },
  { label: 'Health', description: 'Sleep, movement and food that support me', order: 3 },
];

function isoAt(day: string, hour: number, minute = 0): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute).toISOString();
}

/**
 * A new journal starts empty, with the first session (components/engagement/
 * WelcomeDialog.tsx); the sample entries are there for anyone who wants to look
 * around first. A journal that already has entries skips the first session.
 */
export async function seedIfEmpty(): Promise<boolean> {
  const db = getDB();
  const settings = await loadSettings();
  if ((await db.entries.count()) > 0) {
    if (!settings.seeded || !settings.engagement.welcomeDone) await saveSettings({ seeded: true, engagement: { welcomeDone: true } });
    return false;
  }
  return false;
}

export async function seedDatabase(): Promise<void> {
  const db = getDB();
  const today = localDayOf();
  const thresholds = DEFAULT_SETTINGS.thresholds;

  const values: CoreValue[] = VALUES.map((v) => ({ ...v, id: uid('v') }));
  await db.coreValues.bulkPut(values);

  const entryIds: string[] = [];
  for (const s of ENTRIES) {
    const day = addDays(today, s.offset);
    const blocks = s.paragraphs.map((text) => ({ id: uid('b'), text }));
    const created = isoAt(day, s.hour);
    const entry: Entry = {
      id: uid('e'),
      title: s.title,
      createdAt: created,
      updatedAt: isoAt(day, s.hour, s.minutes),
      localDay: day,
      status: 'complete',
      blocks,
      wordCount: countWords(s.paragraphs.join(' ')),
      activeSeconds: s.minutes * 60,
      inputSources: s.dictated ? ['typed', 'dictated'] : ['typed'],
      // Sample entries are never part of "Was this worth your time?".
      worthSkipped: true,
    };
    entryIds.push(entry.id);
    await db.entries.put(entry);
    await db.entryRevisions.add({ id: uid('r'), entryId: entry.id, at: entry.updatedAt, blocks, wordCount: entry.wordCount });

    const t = computeTelemetry(blocks, thresholds);
    await saveTelemetry(entry, t);
    await extractAndStoreMentions(entry, t);
    await storeAlignment(entry.id, heuristicValueAlignment(blocks, values), 'heuristic');
    const syn = heuristicSynthesis(blocks, t, values);
    await db.syntheses.put({ entryId: entry.id, ...syn, provider: 'heuristic', model: 'heuristic-v1', createdAt: entry.updatedAt });

    for (const [i, turn] of (s.turns ?? []).entries()) {
      await db.copilotTurns.add({
        id: uid('t'),
        entryId: entry.id,
        pairId: uid('p'),
        mode: turn.mode,
        lens: null,
        role: 'assistant',
        text: turn.text,
        anchor: { blockId: blocks[Math.min(i + 1, blocks.length - 1)].id, offset: 0 },
        provider: 'heuristic',
        model: 'heuristic-v1',
        fallbackUsed: false,
        incomplete: false,
        createdAt: isoAt(day, s.hour, Math.min(5 + i * 4, 59)),
      });
    }
  }
  await rebuildGraph();
  await rebuildMemoryArtifacts();

  const forecasts: Forecast[] = [
    {
      id: uid('f'),
      entryId: entryIds[0],
      eventName: 'Dentist appointment',
      targetDate: addDays(today, -11),
      predictedDread: 55,
      predictedCoping: 50,
      worstCase: 'Needing a filling and feeling panicky in the chair.',
      actualImpact: 20,
      actualCoping: 75,
      actualNote: 'Ten minutes, no filling. The waiting room was the worst part.',
      calibratedAt: isoAt(addDays(today, -11), 18),
      createdAt: isoAt(addDays(today, -13), 21, 10),
    },
    {
      id: uid('f'),
      entryId: entryIds[0],
      eventName: 'Leadership presentation',
      targetDate: addDays(today, -9),
      predictedDread: 80,
      predictedCoping: 35,
      worstCase: 'I freeze on the first question and Priya regrets choosing me.',
      actualImpact: 35,
      actualCoping: 70,
      actualNote: 'Shaky first minute, then fine. Answered the hard question.',
      calibratedAt: isoAt(addDays(today, -9), 22, 5),
      createdAt: isoAt(addDays(today, -13), 21, 12),
    },
    {
      id: uid('f'),
      entryId: entryIds[1],
      eventName: 'Christmas conversation with Mum',
      targetDate: addDays(today, -3),
      predictedDread: 65,
      predictedCoping: 45,
      worstCase: 'She goes quiet and I feel guilty for weeks.',
      actualImpact: 40,
      actualCoping: 65,
      actualNote: 'Disappointed for a minute, then curious about the plans.',
      calibratedAt: isoAt(addDays(today, -2), 20, 8),
      createdAt: isoAt(addDays(today, -9), 22, 10),
    },
    {
      id: uid('f'),
      entryId: entryIds[3],
      eventName: 'Quarterly review with Priya',
      targetDate: addDays(today, -1),
      predictedDread: 60,
      predictedCoping: 55,
      worstCase: 'She brings up the report again and I go quiet instead of asking for a realistic timeline.',
      actualImpact: null,
      actualCoping: null,
      actualNote: '',
      calibratedAt: null,
      createdAt: isoAt(addDays(today, -2), 20, 12),
    },
  ];
  await db.forecasts.bulkPut(forecasts);

  // The planner: a big event yesterday (with its forecast still to check), one
  // coming up, a repeating run for health, and tasks that came from entries.
  const health = values.find((v) => v.label === 'Health')?.id ?? null;
  const reviewForecast = forecasts[3];
  const sample = (e: Partial<PlanEvent> & Pick<PlanEvent, 'title' | 'startDay'>) => newEvent({ ...e, source: 'sample', createdAt: isoAt(addDays(today, -6), 9), updatedAt: isoAt(addDays(today, -6), 9) });
  const events: PlanEvent[] = [
    sample({ title: 'Quarterly review with Priya', startDay: addDays(today, -1), startTime: '10:00', endTime: '11:00', big: true, forecastId: reviewForecast.id, reminderMinutes: 30, location: 'Meeting room 2' }),
    sample({ title: 'Presentation dry run', startDay: addDays(today, 2), startTime: '14:00', endTime: '15:00', big: true, reminderMinutes: 60 }),
    sample({ title: 'Run along the river', startDay: addDays(today, -6), startTime: '07:30', endTime: '08:15', repeat: { rule: 'FREQ=WEEKLY;BYDAY=WE,SA', fromCompletion: false }, valueId: health, reminderMinutes: 15 }),
    sample({ title: "Dinner with Sam's family", startDay: addDays(today, 5), startTime: '19:00', endTime: '21:30', location: "Sam's parents'" }),
    sample({ title: 'Dentist check-up', startDay: addDays(today, 12), startTime: '09:30', endTime: '10:00', reminderMinutes: 1440 }),
  ];
  await db.events.bulkPut(events);

  const task = (t: Partial<Task> & Pick<Task, 'title'>, createdDaysAgo: number): Task => ({
    id: uid('tk'),
    notes: '',
    status: 'open',
    dueDay: null,
    dueTime: null,
    repeat: null,
    plan: null,
    reminderMinutes: null,
    valueId: null,
    entryId: null,
    blockId: null,
    sourceText: '',
    order: 0,
    createdAt: isoAt(addDays(today, -createdDaysAgo), 21),
    updatedAt: isoAt(addDays(today, -createdDaysAgo), 21),
    doneAt: null,
    reviewedAt: null,
    letGoNote: '',
    repeatOf: null,
    tag: null,
    ...t,
  });
  const firstEntry = await db.entries.get(entryIds[0]);
  const lastEntry = await db.entries.get(entryIds[3]);
  const planBlock = firstEntry?.blocks[3];
  const timelineBlock = lastEntry?.blocks[3];
  const tasks: Task[] = [
    task({ title: 'Draft the slides', status: 'done', dueDay: addDays(today, -12), doneAt: isoAt(addDays(today, -12), 18), entryId: entryIds[0], blockId: planBlock?.id ?? null, sourceText: 'Plan: draft the slides tomorrow' }, 13),
    task({ title: 'Book the dentist appointment', status: 'done', doneAt: isoAt(addDays(today, -11), 12), entryId: entryIds[0], blockId: planBlock?.id ?? null, sourceText: 'finally book the dentist appointment I keep putting off' }, 13),
    task(
      {
        title: 'Ask Priya for a realistic timeline on the next report',
        dueDay: today,
        plan: { when: 'after lunch', where: 'at my desk' },
        entryId: entryIds[3],
        blockId: timelineBlock?.id ?? null,
        sourceText: 'I am going to ask for a realistic timeline on the next report instead of saying yes and resenting it.',
        order: 1,
      },
      2,
    ),
    task({ title: 'Call Mum about Boxing Day', dueDay: addDays(today, 3), dueTime: '18:00', reminderMinutes: 0, order: 2 }, 2),
    task({ title: 'Put the bins out', dueDay: addDays(today, 1), order: 3 }, 20),
    task({ title: 'Pick up the dry cleaning', dueDay: addDays(today, -4), order: 4 }, 6),
    task({ title: 'Renew passport', order: 5 }, 16),
  ];
  // The bins go out on the same weekday every week, starting tomorrow.
  const binsDay = addDays(today, 1).split('-').map(Number);
  tasks[4].repeat = { rule: `FREQ=WEEKLY;BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(binsDay[0], binsDay[1] - 1, binsDay[2]).getDay()]}`, fromCompletion: false };
  await db.tasks.bulkPut(tasks);

  const notes: CaptureNote[] = [
    { id: uid('nt'), kind: 'note', text: 'Look into the climbing wall Sam mentioned', createdAt: isoAt(addDays(today, -3), 13), doneAt: null, entryId: null },
    { id: uid('nt'), kind: 'worry', text: 'Whether the next report deadline is realistic', createdAt: isoAt(addDays(today, -1), 16), doneAt: null, entryId: null },
  ];
  await db.notes.bulkPut(notes);

  await saveSettings({ seeded: true });
  await markAllMigrated();
}
