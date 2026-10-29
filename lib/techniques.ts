// Journalling techniques and the Past, present, future programme. Every prompt
// here is written for NeuroReflect. The evidence grade is our reading of the
// studies, shown in everyday words, and is never a claim that a technique
// treats anything. One exercise per entry, so the journal can tell which helped.

import type { GoalId, GuidanceLevel, GuidanceSettings, TechniqueId } from './types';

export type Evidence = 'strong' | 'promising' | 'early' | 'mixed' | 'linked';

export const EVIDENCE: Record<Evidence, { label: string; note: string }> = {
  strong: { label: 'Strong research', note: 'Backed by reviews that pooled many studies.' },
  promising: { label: 'Promising research', note: 'Good experiments, though not yet of a journal version.' },
  early: { label: 'Early research', note: 'One or two small studies so far.' },
  mixed: { label: 'Mixed research', note: "Small or inconsistent effects, and it doesn't suit everyone." },
  linked: { label: 'Linked in research', note: 'Linked with well-being in long-term studies, but not tested as an exercise.' },
};

export type StepKind = 'write' | 'breathe' | 'plan' | 'name' | 'worries' | 'list';

export interface TechniqueStep {
  kind: StepKind;
  prompt: string;
  hint?: string;
  /** Breathing and timed writing. */
  minutes?: number;
}

export interface Technique {
  id: TechniqueId;
  name: string;
  oneLine: string;
  evidence: Evidence;
  source: string;
  goals: GoalId[];
  minutes: number;
  phase: 'next' | 'later';
  /** Part of the Past, present, future programme. */
  part?: 'future' | 'present' | 'past';
  /** Sessions on separate days (expressive writing). */
  sessions?: number;
  /** Paused while the writing circles: immersed, backward-looking writing can feed the loop (Sbarra et al.). */
  guarded: boolean;
  /** Never on by default; the person ticks it. */
  optIn: boolean;
  /** Days to leave between offers, so prompts are spaced out. */
  spacingDays: number;
  /** A lighter technique to offer from "This is too much", besides breathing and free writing. */
  lighter: TechniqueId | null;
  steps: TechniqueStep[];
}

export const TECHNIQUES: Technique[] = [
  {
    id: 'if_then_feelings',
    name: 'Plan for a feeling',
    oneLine: "Pick the feeling you expect and decide now what you'll do when it shows up.",
    evidence: 'strong',
    source: 'Webb, Schweiger Gallo et al. 2012',
    goals: ['calmer', 'goals'],
    minutes: 3,
    phase: 'next',
    guarded: false,
    optIn: false,
    spacingDays: 0,
    lighter: 'cool_down',
    steps: [
      { kind: 'write', prompt: "What's coming up, and which feeling do you expect to show up when it does?" },
      {
        kind: 'write',
        prompt: "When that feeling arrives, what would help in the moment? Keep it small and doable, like breathing out slowly or telling yourself it's nerves, not danger.",
      },
      { kind: 'plan', prompt: 'Put it together as one plan you can remember.', hint: 'When I notice ..., I will ...' },
    ],
  },
  {
    id: 'cool_down',
    name: 'Cool down first',
    oneLine: 'A minute of slow breathing before you reflect on something that has you wound up.',
    evidence: 'strong',
    source: 'Kjærvik & Bushman 2024',
    goals: ['calmer'],
    minutes: 1,
    phase: 'next',
    guarded: false,
    optIn: false,
    spacingDays: 0,
    lighter: null,
    steps: [
      { kind: 'breathe', prompt: 'Breathe in gently for four, then out slowly for six. Let the out-breath be the longer one.', minutes: 1 },
      { kind: 'write', prompt: "When you're ready, carry on. What do you want to say about it now?" },
    ],
  },
  {
    id: 'savouring',
    name: 'Savour a good moment',
    oneLine: 'Step back into a good moment in detail, however small.',
    evidence: 'strong',
    source: 'Chen et al. 2026',
    goals: ['good_things'],
    minutes: 4,
    phase: 'next',
    guarded: false,
    optIn: false,
    spacingDays: 2,
    lighter: null,
    steps: [
      { kind: 'write', prompt: 'Pick a good moment from today or the last few days. It can be small: a coffee, a laugh, a bit of sun.' },
      { kind: 'write', prompt: 'Step back into it. Where were you? What could you see, hear and smell? Who was there?' },
      { kind: 'write', prompt: 'What made it good? Stay with that for a moment before you move on.' },
    ],
  },
  {
    id: 'self_compassion',
    name: 'A kind letter to yourself',
    oneLine: 'Write to yourself about a setback the way a good friend would.',
    evidence: 'strong',
    source: 'Ferrari et al. 2019',
    goals: ['understand', 'calmer'],
    minutes: 10,
    phase: 'next',
    guarded: false,
    optIn: false,
    spacingDays: 3,
    lighter: 'savouring',
    steps: [
      { kind: 'write', prompt: "Pick something you're hard on yourself about: a mistake, a setback, or something about yourself you don't like." },
      {
        kind: 'write',
        prompt: "Picture a friend who knows you well and is on your side. Write to yourself as they would: warmly and honestly, without pretending it doesn't matter.",
      },
      { kind: 'write', prompt: 'Plenty of people struggle with things like this. What would you want someone else in your shoes to hear?' },
      { kind: 'write', prompt: 'Is there one small, kind thing you could do for yourself today?' },
    ],
  },
  {
    id: 'emotion_naming',
    name: 'Name it more precisely',
    oneLine: "When a word like 'stressed' or 'bad' is doing a lot of work, find a more exact one.",
    evidence: 'promising',
    source: 'Kashdan, Barrett & McKnight 2015',
    goals: ['understand', 'calmer'],
    minutes: 2,
    phase: 'next',
    guarded: false,
    optIn: false,
    spacingDays: 1,
    lighter: null,
    steps: [
      { kind: 'name', prompt: 'Is it closer to one of these? Pick the word that fits best, or more than one.' },
      { kind: 'write', prompt: "What's that feeling about, and what does it need from you?" },
    ],
  },
  {
    id: 'worry_period',
    name: 'Worry period',
    oneLine: 'Park worries during the day and give them one slot, at a set time and place.',
    evidence: 'early',
    source: 'McGowan & Behar 2013',
    goals: ['calmer', 'sleep'],
    minutes: 30,
    phase: 'next',
    guarded: false,
    optIn: false,
    spacingDays: 0,
    lighter: 'cool_down',
    steps: [
      {
        kind: 'worries',
        prompt: "Here are the worries you parked. Take each in turn. Is there something you can do about it? If so, plan the next step. If not, let it wait.",
      },
      { kind: 'write', prompt: "Anything else on your mind? Write it here, and stop when the time's up.", minutes: 30 },
    ],
  },
  {
    id: 'concrete_step',
    name: 'How, not why',
    oneLine: "Swap 'why did this happen' for 'how exactly did it happen, and what could I do next'.",
    evidence: 'early',
    source: 'Watkins et al. 2012',
    goals: ['decisions', 'goals', 'calmer'],
    minutes: 5,
    phase: 'next',
    guarded: false,
    optIn: false,
    spacingDays: 0,
    lighter: 'cool_down',
    steps: [
      { kind: 'write', prompt: "Pick one specific moment from what you've written. What happened, step by step, as if you were describing a film?" },
      { kind: 'write', prompt: 'In that moment, what did you notice? What you saw, what you heard, what you felt in your body and what you did.' },
      { kind: 'write', prompt: "What's one small, specific thing you could do differently next time? How exactly would you do it?" },
      { kind: 'plan', prompt: 'Turn it into a plan.', hint: 'When ..., I will ...' },
    ],
  },
  {
    id: 'kindness',
    name: 'Kindness day',
    oneLine: 'Plan a few small kind acts for one day, then note how it went.',
    evidence: 'strong',
    source: 'Curry et al. 2018',
    goals: ['relationships', 'good_things'],
    minutes: 3,
    phase: 'later',
    guarded: false,
    optIn: false,
    spacingDays: 7,
    lighter: null,
    steps: [
      { kind: 'list', prompt: 'Pick a day this week and plan three small kind things to do for other people on it. Each line becomes a task for that day.' },
    ],
  },
  {
    id: 'forgiveness',
    name: 'Finding something in it',
    oneLine: 'Only if you want to: look for anything that came out of a hurt, without excusing it.',
    evidence: 'early',
    source: 'McCullough, Root & Cohen 2006',
    goals: ['relationships'],
    minutes: 10,
    phase: 'later',
    guarded: true,
    optIn: true,
    spacingDays: 30,
    lighter: 'savouring',
    steps: [
      { kind: 'write', prompt: "Think about a time someone hurt or let you down. You don't have to excuse it, or feel any particular way about it." },
      { kind: 'write', prompt: 'Has anything come out of it for you, even something small? Something you learned, a strength you found, or a relationship that grew.' },
      { kind: 'write', prompt: "How do you feel about it now that you've written this?" },
    ],
  },
  {
    id: 'three_good_things',
    name: 'Three good things',
    oneLine: 'Once a week: three things that went well, and why each one happened.',
    evidence: 'mixed',
    source: 'Gander, Proyer, Ruch & Wyss',
    goals: ['good_things', 'sleep'],
    minutes: 5,
    phase: 'later',
    guarded: false,
    optIn: false,
    spacingDays: 7,
    lighter: null,
    steps: [{ kind: 'write', prompt: 'What are three things that went well this week? For each one, add a line about why it happened.' }],
  },
  {
    id: 'values_first',
    name: 'Values first',
    oneLine: 'Before something hard, such as difficult feedback, write a few lines about a value that matters to you.',
    evidence: 'mixed',
    source: 'Epton et al. 2015',
    goals: ['goals', 'decisions'],
    minutes: 4,
    phase: 'later',
    guarded: false,
    optIn: false,
    spacingDays: 2,
    lighter: null,
    steps: [
      { kind: 'write', prompt: 'Before you face it, pick one of your values: {values}.' },
      { kind: 'write', prompt: 'Why does it matter to you? Write about a time you lived by it.' },
    ],
  },
  {
    id: 'expressive',
    name: 'Writing it out',
    oneLine: 'Four sessions on four days, writing freely about something that has affected you.',
    evidence: 'mixed',
    source: 'Frattaroli 2006',
    goals: ['understand', 'story'],
    minutes: 15,
    phase: 'later',
    sessions: 4,
    guarded: true,
    optIn: true,
    spacingDays: 1,
    lighter: 'cool_down',
    steps: [
      {
        kind: 'write',
        prompt:
          "For the next fifteen minutes, write about something that has been weighing on you: what happened, how you felt then, and how you feel about it now. Spelling and neatness don't matter, and you can write about the same thing each time or something new.",
        hint: 'Feeling a bit worse straight afterwards is common, so how it went is judged over the following days.',
        minutes: 15,
      },
    ],
  },
  {
    id: 'next_chapter',
    name: 'Next chapter',
    oneLine: 'Picture a good future, find the main thing in the way, and make a plan for it.',
    evidence: 'promising',
    source: 'Wang, Wang & Gai 2021; Kappes & Oettingen 2011',
    goals: ['goals', 'story', 'decisions'],
    minutes: 20,
    phase: 'next',
    part: 'future',
    guarded: false,
    optIn: false,
    spacingDays: 14,
    lighter: 'savouring',
    steps: [
      {
        kind: 'write',
        prompt:
          'Picture your life three to five years from now, if things go well in the ways that matter to you. What does an ordinary good day look like? Work, people, health, what you do for fun.',
      },
      { kind: 'write', prompt: 'Of everything you pictured, which one wish matters most and feels possible? Put it in one sentence.' },
      { kind: 'write', prompt: 'What would be the best thing about getting there? Let yourself picture it for a moment.' },
      { kind: 'write', prompt: 'Now the honest part. What in you most often gets in the way: a habit, a feeling, a belief? Name the main one.' },
      { kind: 'plan', prompt: 'When that shows up, what will you do? Make it a plan.', hint: 'When ..., I will ...' },
    ],
  },
  {
    id: 'strengths',
    name: 'Strengths and snags',
    oneLine: 'Real times you used a strength, a new way to use it, and one snag written about kindly.',
    evidence: 'promising',
    source: 'Schutte & Malouff 2019; Breines & Chen 2012',
    goals: ['understand', 'goals'],
    minutes: 15,
    phase: 'later',
    part: 'present',
    guarded: false,
    optIn: false,
    spacingDays: 14,
    lighter: 'savouring',
    steps: [
      { kind: 'write', prompt: 'Think of a recent time you were at your best. What were you doing, and which of your strengths was showing?' },
      { kind: 'write', prompt: "Pick one of those strengths. What's a new way you could use it this week?" },
      { kind: 'plan', prompt: "Plan when you'll try it.", hint: 'When ..., I will ...' },
      {
        kind: 'write',
        prompt: "Now one snag: something about yourself you'd like to work on. Write about it the way a kind, honest friend would: what's hard about it, and what might help.",
      },
    ],
  },
  {
    id: 'your_story',
    name: 'Your story',
    oneLine: 'The chapters of your life so far, a turning point, and what you did and who was with you.',
    evidence: 'linked',
    source: 'Lind et al. 2024',
    goals: ['story', 'understand'],
    minutes: 20,
    phase: 'later',
    part: 'past',
    guarded: true,
    optIn: false,
    spacingDays: 14,
    lighter: 'savouring',
    steps: [
      { kind: 'write', prompt: 'If your life so far were a book, what would its chapters be called? Just list them.' },
      { kind: 'write', prompt: 'Pick a turning point: a moment after which things were different. What happened?' },
      { kind: 'write', prompt: 'In that moment, what did you do? What choices did you make, even small ones?' },
      { kind: 'write', prompt: 'Who was with you, or who helped? What did they mean to you?' },
      { kind: 'write', prompt: 'What did it teach you that you still carry with you?' },
    ],
  },
];

export const PROGRAMME_NAME = 'Past, present, future';

export function getTechnique(id: TechniqueId): Technique {
  const t = TECHNIQUES.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown technique ${id}`);
  return t;
}

export const GOALS: { id: GoalId; label: string; blurb: string }[] = [
  { id: 'understand', label: 'Understand myself better', blurb: 'Notice patterns in how I think and react' },
  { id: 'calmer', label: 'Handle stress and big feelings', blurb: 'Feel calmer when things pile up' },
  { id: 'goals', label: 'Work towards goals', blurb: 'Turn what I want into plans' },
  { id: 'relationships', label: 'Relationships', blurb: 'The people in my life' },
  { id: 'sleep', label: 'Sleep better', blurb: 'Clear my head before bed' },
  { id: 'good_things', label: 'Notice good things', blurb: 'Hold on to what goes well' },
  { id: 'decisions', label: 'Make decisions', blurb: 'Think choices through' },
  { id: 'story', label: 'Make sense of my story', blurb: 'Where I have been and where I am going' },
];

export const LEVELS: { id: GuidanceLevel; label: string; blurb: string }[] = [
  { id: 'blank', label: 'Blank page', blurb: 'Just you and the page. Nothing is suggested.' },
  { id: 'open', label: 'Open', blurb: 'One open prompt to start you off, like "What\'s on your mind?"' },
  { id: 'guided', label: 'Guided', blurb: 'A specific prompt from your goals, your planner and what you have written before.' },
  { id: 'deep', label: 'Deep', blurb: 'Guided, plus techniques and the programme, tailored with the tick boxes in Settings.' },
];

/**
 * Whether a technique may be offered. The tick box wins; otherwise Guided
 * offers the Next-phase techniques and Deep offers everything except opt-ins.
 */
export function techniqueEnabled(id: TechniqueId, guidance: Pick<GuidanceSettings, 'level' | 'techniques'>): boolean {
  if (guidance.level === 'blank' || guidance.level === 'open') return false;
  const ticked = guidance.techniques[id];
  if (ticked !== undefined) return ticked;
  const t = getTechnique(id);
  if (t.optIn) return false;
  if (guidance.level === 'deep') return true;
  return t.phase === 'next' && !t.part;
}

/** "This is too much": the lighter options offered for a technique, in order. */
export function lighterOptions(id: TechniqueId): ('breathe' | 'free' | 'stop' | TechniqueId)[] {
  const t = getTechnique(id);
  const out: ('breathe' | 'free' | 'stop' | TechniqueId)[] = [];
  if (id !== 'cool_down') out.push('breathe');
  if (t.lighter && t.lighter !== 'cool_down') out.push(t.lighter);
  out.push('free', 'stop');
  return out;
}
