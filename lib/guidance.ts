// The guided prompt engine. Picks one starter prompt for a new entry, and at
// most one technique to offer, from the person's goals, their planner, what
// they have written before and how the current entry reads. Deterministic and
// local: the same journal gives the same choice, every reason is shown, and
// nothing here needs an AI provider.
//
// Two rules sit above every level: while the writing circles, nothing asks an
// immersed "why" question or starts backward-looking writing (Sbarra et al.);
// and a topic the person asked to leave alone is never raised.

import { getDB, loadSettings } from './db';
import { describeWhen, inSentence } from './nl-date';
import { comingUp, loadAgendaData, recentlyPast, upcomingBig, type AgendaData, type Occurrence } from './planner';
import { detectFutureEvent, findFusionSpans } from './psych-engine';
import { getTechnique, techniqueEnabled, TECHNIQUES } from './techniques';
import type {
  AppSettings,
  Block,
  CaptureNote,
  CoreValue,
  EntryExercise,
  EntryPrompt,
  GoalId,
  GraphNode,
  GuidanceSettings,
  LocalDay,
  PlannerSettings,
  Task,
  TechniqueId,
  Telemetry,
  Thread,
} from './types';
import { addDays, formatDay, localDayOf } from './util';

export interface RecentEntry {
  id: string;
  localDay: LocalDay;
  status: 'draft' | 'complete';
  prompt: EntryPrompt | null;
  exercise: EntryExercise | null;
  circled: boolean;
}

export interface GuidanceContext {
  now: Date;
  today: LocalDay;
  guidance: GuidanceSettings;
  planner: PlannerSettings;
  values: CoreValue[];
  /** Newest first, the last 30 days. */
  recent: RecentEntry[];
  agenda: AgendaData;
  threads: Thread[];
  nodes: GraphNode[];
  worries: CaptureNote[];
}

export interface TechniqueOffer {
  technique: TechniqueId;
  reason: string;
  /** Expressive writing counts sessions; the programme counts parts. */
  session?: number;
}

export interface StarterPick {
  /** In order of preference; the card shows the first and "Another" moves along. */
  prompts: EntryPrompt[];
  offer: TechniqueOffer | null;
}

// ---------- prompt text ----------

export const OPEN_PROMPTS: { id: string; text: string }[] = [
  { id: 'open:mind', text: "What's on your mind?" },
  { id: 'open:day', text: 'Tell me about your day.' },
  { id: 'open:space', text: "What's been taking up space in your head?" },
  { id: 'open:start', text: 'Where would you like to start today?' },
  { id: 'open:remember', text: "What happened today that you'd like to remember?" },
  { id: 'open:now', text: 'How are things, right now?' },
];

const GOAL_PROMPTS: Record<GoalId, { id: string; text: string }[]> = {
  understand: [
    { id: 'goal:understand:surprise', text: 'What surprised you about how you reacted to something today?' },
    { id: 'goal:understand:energy', text: 'When did you feel most like yourself today, and when least?' },
    { id: 'goal:understand:notice', text: 'What did you notice yourself doing today that you often do?' },
  ],
  calmer: [
    { id: 'goal:calmer:energy', text: 'What took most of your energy today?' },
    { id: 'goal:calmer:steady', text: 'What helped you feel steadier today, even for a moment?' },
    { id: 'goal:calmer:carry', text: "What are you carrying into tomorrow that you'd like to put down?" },
  ],
  goals: [
    { id: 'goal:goals:forward', text: 'What did you move forward today, even a little?' },
    { id: 'goal:goals:next', text: "What's the next small step on something that matters to you?" },
    { id: 'goal:goals:block', text: "What's been getting in the way of something you want, and what could you try?" },
  ],
  relationships: [
    { id: 'goal:relationships:who', text: 'Who did you spend time with today, and how was it?' },
    { id: 'goal:relationships:miss', text: "Who's been on your mind lately, and why?" },
    { id: 'goal:relationships:moment', text: 'What was a good moment with someone this week?' },
  ],
  sleep: [
    { id: 'goal:sleep:settle', text: 'What would help you settle tonight?' },
    { id: 'goal:sleep:park', text: "What's still buzzing around from today? Write it down so it can wait until morning." },
  ],
  good_things: [
    { id: 'goal:good:one', text: "What's one good thing from today, however small?" },
    { id: 'goal:good:made', text: 'What made you smile today?' },
    { id: 'goal:good:grateful', text: "Who or what are you glad of this week?" },
  ],
  decisions: [
    { id: 'goal:decisions:options', text: 'Is there a decision on your mind? What are the options as you see them?' },
    { id: 'goal:decisions:advice', text: 'If a friend faced the choice you are facing, what would you tell them?' },
  ],
  story: [
    { id: 'goal:story:past', text: "What's something from your past that's been on your mind?" },
    { id: 'goal:story:changed', text: 'How are you different from the person you were a year ago?' },
  ],
};

const GUIDED_DEFAULT: { id: string; text: string }[] = [
  { id: 'guided:happy', text: 'What made you happy today?' },
  { id: 'guided:best', text: 'What was the best part of your day, and what made it good?' },
  { id: 'guided:hard', text: 'What was the hardest part of today, and how did you handle it?' },
  { id: 'guided:learned', text: 'What did today teach you?' },
];

// ---------- helpers ----------

function mentionsAvoided(text: string, avoid: string[]): boolean {
  const lower = text.toLowerCase();
  return avoid.some((topic) => {
    const t = topic.trim().toLowerCase();
    if (t.length < 2) return false;
    return new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(lower);
  });
}

function lastUsedDay(recent: RecentEntry[], predicate: (e: RecentEntry) => boolean): LocalDay | null {
  return recent.find(predicate)?.localDay ?? null;
}

function daysSince(day: LocalDay | null, today: LocalDay): number {
  if (!day) return Infinity;
  const [y, m, d] = day.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return Math.round((new Date(ty, tm - 1, td).getTime() - new Date(y, m - 1, d).getTime()) / 86400000);
}

function promptUsedWithin(recent: RecentEntry[], id: string, today: LocalDay, days: number): boolean {
  return daysSince(lastUsedDay(recent, (e) => e.prompt?.id === id), today) < days;
}

/** Least recently used first, so prompts rotate rather than repeat. */
function rotate<T extends { id: string }>(items: T[], recent: RecentEntry[]): T[] {
  const lastIndex = (id: string) => {
    const i = recent.findIndex((e) => e.prompt?.id === id);
    return i < 0 ? Infinity : i;
  };
  return items
    .map((item, order) => ({ item, order, last: lastIndex(item.id) }))
    .sort((a, b) => b.last - a.last || a.order - b.order)
    .map((x) => x.item);
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** The last two finished entries circled: hold back immersed and backward-looking writing. */
export function recentlyCircling(recent: RecentEntry[], today: LocalDay): boolean {
  const finished = recent.filter((e) => e.status === 'complete' && daysSince(e.localDay, today) <= 3);
  return finished.slice(0, 2).some((e) => e.circled);
}

function weekdayName(day: LocalDay): string {
  return formatDay(day, { weekday: 'long' });
}

function occurrenceWhen(o: Occurrence, today: LocalDay): string {
  const label = describeWhen(o.day, o.startTime, today);
  return inSentence(label);
}

function lastSession(recent: RecentEntry[], id: TechniqueId): EntryExercise | null {
  return recent.find((e) => e.exercise?.technique === id)?.exercise ?? null;
}

function canOffer(id: TechniqueId, ctx: GuidanceContext, circling: boolean): boolean {
  if (!techniqueEnabled(id, ctx.guidance)) return false;
  const t = getTechnique(id);
  if (t.guarded && circling) return false;
  if (mentionsAvoided(`${t.name} ${t.oneLine}`, ctx.guidance.avoidTopics)) return false;
  if (t.spacingDays > 0) {
    const last = lastUsedDay(ctx.recent, (e) => e.exercise?.technique === id);
    if (daysSince(last, ctx.today) < t.spacingDays) return false;
  }
  return true;
}

// ---------- the starter ----------

export function pickStarter(ctx: GuidanceContext): StarterPick {
  const { guidance, today, recent, agenda } = ctx;
  if (guidance.level === 'blank') return { prompts: [], offer: null };
  const avoid = guidance.avoidTopics;
  const ok = (p: { text: string }) => !mentionsAvoided(p.text, avoid);

  if (guidance.level === 'open') {
    const prompts = rotate(OPEN_PROMPTS, recent)
      .filter(ok)
      .map((p) => ({ ...p, reason: 'An open start. Write about whatever comes.', level: 'open' as const }));
    return { prompts, offer: null };
  }

  const level = guidance.level;
  const circling = recentlyCircling(recent, today);
  const prompts: EntryPrompt[] = [];
  let offer: TechniqueOffer | null = null;
  const add = (id: string, text: string, reason: string) => {
    if (prompts.some((p) => p.id === id) || !ok({ text }) || mentionsAvoided(reason, avoid)) return false;
    prompts.push({ id, text, reason, level });
    return true;
  };
  const valueName = (id: string | null) => ctx.values.find((v) => v.id === id)?.label ?? null;

  // 1. A forecast waiting for its reality check.
  const forecastAsked = new Set<string>();
  for (const f of agenda.forecasts) {
    if (f.calibratedAt || f.targetDate > today || daysSince(f.targetDate, today) > 7) continue;
    if (add(`forecast:${f.id}`, `How did ${f.eventName} go?`, `You forecast how it would feel. The reality check above compares that with how it went.`)) forecastAsked.add(f.id);
  }

  // 2. Big events and planned things that matter, just past: "How did Thursday go?"
  for (const o of recentlyPast(agenda, today)) {
    const id = `after:${o.key}`;
    if (promptUsedWithin(recent, id, today, 30)) continue;
    if (o.event.forecastId && forecastAsked.has(o.event.forecastId)) continue;
    const value = valueName(o.event.valueId);
    if (value) add(id, `You planned ${o.event.title} for ${value.toLowerCase()}. How did it go?`, `It was in your planner for ${weekdayName(o.day)}.`);
    else add(id, `How did ${o.event.title} go on ${weekdayName(o.day)}?`, `It was in your planner, marked as mattering to you.`);
  }

  // 3. Something big coming up.
  for (const o of upcomingBig(agenda, today)) {
    const id = `before:${o.key}`;
    if (promptUsedWithin(recent, id, today, 2)) continue;
    if (add(id, `${o.event.title} is ${occurrenceWhen(o, today)}. What's on your mind about it?`, 'It is in your planner, marked as mattering to you.') && !offer) {
      const feedbackLike = /\b(review|feedback|appraisal|interview|exam|test|presentation|assessment|results?)\b/i.test(o.event.title);
      if (feedbackLike && canOffer('values_first', ctx, circling)) offer = { technique: 'values_first', reason: `Before ${o.event.title}, a few lines about a value that matters to you.` };
      else if (canOffer('if_then_feelings', ctx, circling)) offer = { technique: 'if_then_feelings', reason: `${o.event.title} is ${occurrenceWhen(o, today)}. Plan now for the feeling it might bring.` };
    }
  }

  // 4. The worry period, when it is on and it is time.
  const wp = ctx.planner.worryPeriod;
  if (wp.enabled && techniqueEnabled('worry_period', guidance)) {
    const nowMin = ctx.now.getHours() * 60 + ctx.now.getMinutes();
    const startMin = minutesOf(wp.time);
    if (nowMin >= startMin - 10 && nowMin <= startMin + wp.minutes + 30) {
      const parked = ctx.worries.filter((w) => w.kind === 'worry' && !w.doneAt).length;
      if (add('worry-period', "It's your worry period. Give your worries this time, then let them rest.", parked ? `You parked ${parked} worr${parked === 1 ? 'y' : 'ies'} for now.` : 'Your daily worry period has started.') && !offer) {
        offer = { technique: 'worry_period', reason: `${wp.minutes} minutes, ${wp.place || 'at your usual place'}.` };
      }
    }
  }

  // 5. Bedtime: tomorrow's list, when better sleep is a goal.
  const hour = ctx.now.getHours() * 60 + ctx.now.getMinutes();
  if (ctx.planner.bedtimeList.enabled && guidance.goals.includes('sleep') && (hour >= minutesOf(ctx.planner.bedtimeList.after) || hour < 180)) {
    add('tomorrow-list', "Before you sleep: what's on tomorrow's list?", 'Better sleep is one of your goals, and the list lands in your planner for tomorrow.');
  }

  // 6. Follow-ups on things the person planned.
  const doneLately = agenda.tasks.filter((t: Task) => t.status === 'done' && t.doneAt && daysSince(localDayOf(new Date(t.doneAt)), today) <= 2);
  for (const t of doneLately) {
    const value = valueName(t.valueId);
    if (!value) continue;
    add(`done:${t.id}`, `You did ${t.title} for ${value.toLowerCase()}. How did it feel?`, 'You planned it as something that matters to you.');
  }
  const kindnessDay = agenda.tasks.find((t) => t.tag === 'kindness' && t.dueDay && t.dueDay < today && daysSince(t.dueDay, today) <= 3);
  if (kindnessDay?.dueDay) add(`kindness-after:${kindnessDay.dueDay}`, 'How did your kindness day go? What did you do, and how did it feel?', `You planned kind acts for ${weekdayName(kindnessDay.dueDay)}.`);

  // 7. A storyline about someone that keeps building.
  const nodeKind = new Map(ctx.nodes.map((n) => [n.id, n.kind]));
  for (const th of ctx.threads) {
    if (th.trend !== 'building' || daysSince(th.lastDay, today) > 7) continue;
    if (nodeKind.get(th.nodeIds[0]) !== 'person') continue;
    const id = `thread:${th.title.toLowerCase()}`;
    if (promptUsedWithin(recent, id, today, 14)) continue;
    add(id, `${th.title} has come up a lot lately. How are things now?`, `${th.title} appears in ${th.entryIds.length} entries, and they have read heavier lately.`);
    if (!offer && level === 'deep' && canOffer('forgiveness', ctx, circling)) {
      offer = { technique: 'forgiveness', reason: `Only if you want to. Nothing here is about excusing anything.` };
    }
  }

  // 8. The weekly review day.
  const reviewDay = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate()).getDay() === ctx.planner.weeklyReviewDay;
  if (reviewDay) add('weekly-review', 'What moved forward this week, even a little?', 'It is your weekly review day. The planner has the week side by side.');

  // 9. Goal prompts, rotated, then the general guided ones.
  const goalPrompts = guidance.goals.flatMap((g) => GOAL_PROMPTS[g].filter((p) => !(g === 'story' && circling)));
  for (const p of rotate(goalPrompts, recent)) add(p.id, p.text, 'From the goals you chose in setup.');
  for (const p of rotate(GUIDED_DEFAULT, recent)) add(p.id, p.text, guidance.goals.length ? 'A change from your usual prompts.' : 'Choose goals in Settings to make prompts more personal.');

  // Deep adds a technique when nothing in the planner called for one.
  if (!offer && level === 'deep') offer = pickTechnique(ctx, circling);
  return { prompts, offer };
}

function pickTechnique(ctx: GuidanceContext, circling: boolean): TechniqueOffer | null {
  const { recent, today, guidance } = ctx;
  if (circling) {
    if (canOffer('concrete_step', ctx, true)) return { technique: 'concrete_step', reason: 'Your last entries circled, so this swaps why questions for how ones.' };
    if (canOffer('self_compassion', ctx, true)) return { technique: 'self_compassion', reason: 'Your last entries were hard on you. This is a kinder angle.' };
    return null;
  }
  // Writing it out runs on consecutive days, and pauses if the writing has been circling.
  const lastExpressive = lastSession(recent, 'expressive');
  if (lastExpressive && lastExpressive.session < (getTechnique('expressive').sessions ?? 4) && canOffer('expressive', ctx, circling)) {
    const gap = daysSince(lastUsedDay(recent, (e) => e.exercise?.technique === 'expressive'), today);
    if (gap >= 1 && gap <= 3) return { technique: 'expressive', session: lastExpressive.session + 1, reason: `Session ${lastExpressive.session + 1} of 4.` };
  }
  // The programme: future first, then present, then past.
  for (const id of ['next_chapter', 'strengths', 'your_story'] as const) {
    const done = recent.some((e) => e.exercise?.technique === id && e.exercise.finishedAt);
    if (done) continue;
    if (canOffer(id, ctx, circling)) return { technique: id, reason: id === 'next_chapter' ? 'The programme starts with the future: you leave with a plan.' : 'The next part of the programme.' };
    break;
  }
  const goals = new Set(guidance.goals);
  const byGoal = TECHNIQUES.filter((t) => t.id !== 'worry_period' && t.id !== 'expressive' && !t.part && canOffer(t.id, ctx, circling));
  const ranked = byGoal
    .map((t) => ({ t, score: t.goals.filter((g) => goals.has(g)).length * 2 + (t.evidence === 'strong' ? 1 : 0), last: daysSince(lastUsedDay(recent, (e) => e.exercise?.technique === t.id), today) }))
    .filter((x) => x.score > 0 || goals.size === 0)
    .sort((a, b) => b.score - a.score || b.last - a.last);
  // Techniques that respond to a moment (a coming event, a hot entry) are offered live instead.
  const pick = ranked.find((x) => !['if_then_feelings', 'cool_down', 'emotion_naming', 'concrete_step'].includes(x.t.id));
  return pick ? { technique: pick.t.id, reason: goals.size ? 'Matched to your goals.' : 'Something to try today.' } : null;
}

// ---------- live offers while writing ----------

const HOT_WORDS = /\b(angry|furious|livid|rage|raging|fuming|seething|annoyed|irritated|frustrated|resentful|wound up|pissed off|so mad)\b/i;

export interface LiveArgs {
  guidance: GuidanceSettings;
  telemetry: Telemetry;
  circling: boolean;
  blocks: Block[];
  exercise: EntryExercise | null;
  dismissed: Set<TechniqueId>;
}

/** At most one offer, from how the entry reads right now. Never while an exercise is running. */
export function liveOffer(args: LiveArgs): TechniqueOffer | null {
  const { guidance, telemetry: t, circling, blocks, exercise, dismissed } = args;
  if (exercise && !exercise.finishedAt && !exercise.exitedAt) return null;
  if (exercise) return null; // one exercise per entry
  const can = (id: TechniqueId) => techniqueEnabled(id, guidance) && !dismissed.has(id);
  const text = blocks.map((b) => b.text).join('\n');
  if (circling && can('concrete_step')) return { technique: 'concrete_step', reason: "Your writing is circling, so this swaps 'why' questions for 'how' ones." };
  if (t.wordCount >= 40 && t.negAffectDensity > 0.06 && HOT_WORDS.test(text) && can('cool_down')) {
    return { technique: 'cool_down', reason: 'This entry sounds wound up. A minute to slow down first.' };
  }
  if (t.wordCount >= 30 && detectFutureEvent(text) && t.negAffectDensity > 0.02 && can('if_then_feelings')) {
    return { technique: 'if_then_feelings', reason: "Something's coming up that you're not looking forward to. Plan for the feeling now?" };
  }
  const selfCritical = findFusionSpans(blocks).some((s) => !s.defused && s.pattern === 'overgeneralise');
  if (selfCritical && t.wordCount >= 40 && can('self_compassion')) {
    return { technique: 'self_compassion', reason: "You're being hard on yourself here. Try writing to yourself as a friend would?" };
  }
  if (t.coarseLabels.length > 0 && t.wordCount >= 60 && can('emotion_naming')) {
    return { technique: 'emotion_naming', reason: `"${t.coarseLabels[0]}" is doing a lot of work here. Find a more exact word?` };
  }
  return null;
}

// ---------- loading the context ----------

export async function loadGuidanceContext(settings?: AppSettings, now: Date = new Date()): Promise<GuidanceContext> {
  const db = getDB();
  const s = settings ?? (await loadSettings());
  const today = localDayOf(now);
  const since = addDays(today, -30);
  const [entries, telemetry, values, agenda, threads, nodes, notes] = await Promise.all([
    db.entries.where('localDay').aboveOrEqual(since).toArray(),
    db.telemetry.where('localDay').aboveOrEqual(since).toArray(),
    db.coreValues.orderBy('order').toArray(),
    loadAgendaData(),
    db.threads.toArray(),
    db.nodes.toArray(),
    db.notes.toArray(),
  ]);
  const circled = new Set(telemetry.filter((t) => t.ruminationFlag).map((t) => t.entryId));
  const recent: RecentEntry[] = entries
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((e) => ({ id: e.id, localDay: e.localDay, status: e.status, prompt: e.prompt ?? null, exercise: e.exercise ?? null, circled: circled.has(e.id) }));
  return { now, today, guidance: s.guidance, planner: s.planner, values, recent, agenda, threads, nodes, worries: notes };
}

/** Items for the Coming up strip above the editor. */
export function comingUpForJournal(ctx: GuidanceContext): ReturnType<typeof comingUp> {
  return comingUp(ctx.agenda, ctx.today, 3).slice(0, 4);
}
