// Offline co-pilot. Builds prompts from the deterministic telemetry and the
// person's own sentences, so the app is useful with no model configured.

import { findFusionSpans, lastSentence, mostChargedSentence, patternName } from './psych-engine';
import type { Block, CoreValue, LensId, Telemetry } from './types';

function pick<T>(items: T[], seed: number): T {
  return items[Math.abs(seed) % items.length];
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function quote(s: string, max = 90): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}...` : t;
}

export function heuristicSocratic(blocks: Block[], t: Telemetry, asked: string[], seedExtra = 0): string {
  const last = lastSentence(blocks);
  const charged = mostChargedSentence(blocks);
  const fused = findFusionSpans(blocks).filter((s) => !s.defused);
  const seed = hash(last) + asked.length + seedExtra;
  const candidates: string[] = [];

  if (fused.length) {
    const f = fused[fused.length - 1];
    candidates.push(
      `You wrote "${quote(f.text, 60)}". What would someone who knows you well say is missing from that sentence?`,
      `If "${quote(f.text, 60)}" were only true some of the time, when was the last exception?`,
    );
  }
  if (t.avoidanceHits.length) {
    candidates.push(
      `What feeling were you making room not to feel when you ${t.avoidanceHits[0].replace(/^i /, '')}?`,
      'If you stopped avoiding it for ten minutes, what is the first thing you would have to face?',
    );
  }
  if (t.coarseLabels.length) {
    const w = t.coarseLabels[0];
    candidates.push(`When you say "${w}", where do you notice it in your body, and what is it closest to?`);
  }
  if (t.cogProcDensity < 0.02 && t.wordCount > 40) {
    candidates.push('What do you think is actually driving this, underneath the events themselves?');
  }
  if (t.posAffectDensity > t.negAffectDensity && t.wordCount > 30) {
    candidates.push('What made today work, and how much of that was your doing?');
  }
  if (charged) {
    candidates.push(
      `Looking at "${quote(charged, 70)}", what need of yours is underneath it?`,
      `What would change if "${quote(charged, 60)}" turned out to be only half the story?`,
    );
  }
  candidates.push(
    'What are you hoping will happen here, and what are you afraid will happen instead?',
    'What part of this is yours to act on this week?',
    'What have you not let yourself write yet?',
  );

  const fresh = candidates.filter((c) => !asked.includes(c));
  return pick(fresh.length ? fresh : candidates, seed);
}

export function heuristicDistancing(blocks: Block[], userName: string, seedExtra = 0): string {
  const charged = mostChargedSentence(blocks);
  const who = userName.trim();
  const seed = hash(charged) + seedExtra;
  const options = [
    who
      ? `Try writing the next few lines about ${who} in the third person. What is ${who} going through, and what does ${who} need right now?`
      : 'Try writing the next few lines about yourself in the third person, as "they". What are they going through, and what do they need?',
    'Picture yourself twelve months from now reading this. How do you think that version of you will see this exact situation?',
    who
      ? `If a close friend described ${who}'s day to you exactly as you have here, what would you say to them?`
      : 'If a close friend described this day to you in exactly these words, what would you say to them?',
    'Zoom out to the next five years. Where does today sit in that longer story?',
  ];
  return pick(options, seed);
}

// "How exactly", never "why": concrete questions for a circling entry (Watkins et al. 2012).
export function heuristicConcrete(blocks: Block[], seedExtra = 0): string {
  const charged = mostChargedSentence(blocks);
  const seed = hash(charged) + seedExtra;
  const options = [
    charged
      ? `Take the moment behind "${quote(charged, 60)}". What happened, step by step, as if you were describing a film?`
      : 'Pick one specific moment from today. What happened, step by step, as if you were describing a film?',
    'In that moment, what exactly did you see, hear and do?',
    'What is one small, specific thing you could do the next time a moment like this comes up, and how exactly would you do it?',
    'What happened just before it started to feel this way?',
  ];
  return pick(options, seed);
}

export function heuristicLens(lens: LensId, blocks: Block[], t: Telemetry, values: CoreValue[]): string {
  const sentences = blocks
    .map((b) => b.text)
    .join(' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  const fused = findFusionSpans(blocks).filter((s) => !s.defused);
  const charged = mostChargedSentence(blocks);

  if (lens === 'stoic') {
    const mine = sentences.filter((s) => /\b(i (?:could|can|will|might|chose|decided|did|said)|my (?:choice|response|reply|effort))\b/i.test(s)).slice(0, 2);
    const notMine = sentences.filter((s) => /\b(they|he|she|everyone|people|weather|traffic|deadline|the company|my (?:boss|manager))\b/i.test(s)).slice(0, 2);
    return [
      `Within your control: ${mine.length ? mine.map((s) => quote(s, 70)).join(' / ') : 'your next response, how you prepare, what you ask for.'}`,
      `Outside your control: ${notMine.length ? notMine.map((s) => quote(s, 70)).join(' / ') : "other people's reactions and timing."}`,
      'A question: if you spent your energy only on the first list this week, what would you do first?',
    ].join('\n');
  }

  if (lens === 'first_principles') {
    const facts = sentences.filter((s) => /\b(\d+|said|happened|was|were|went|got|had|told)\b/i.test(s) && !/\b(always|never|think|feel|probably|must)\b/i.test(s)).slice(0, 2);
    const assumptions = [...fused.map((f) => f.text), ...sentences.filter((s) => /\b(should|must|have to|need to|probably|obviously)\b/i.test(s))].slice(0, 2);
    return [
      `Facts: ${facts.length ? facts.map((s) => quote(s, 70)).join(' / ') : 'only what you directly observed happened.'}`,
      `Assumptions: ${assumptions.length ? assumptions.map((s) => quote(s, 70)).join(' / ') : 'the meaning you attached to those events.'}`,
      'A question: starting only from the facts, what is the simplest explanation?',
    ].join('\n');
  }

  if (lens === 'cbt') {
    const thought = fused[0]?.text ?? charged;
    const against = sentences.filter((s) => /\b(but|although|though|actually|still|managed|did)\b/i.test(s)).slice(0, 1);
    return [
      `Situation: ${quote(sentences[0] ?? 'the events in this entry', 90)}`,
      `The thought: "${quote(thought, 90)}"`,
      `Evidence for: the feelings were real and ${t.negAffectDensity > 0.03 ? 'strong' : 'present'} (guess).`,
      `Evidence against: ${against.length ? quote(against[0], 90) : 'what has gone differently before (worth adding).'}`,
      `A more balanced thought: "Part of me believes ${quote(thought.replace(/^i /i, 'I '), 60)}, and I also know it is not the whole picture."`,
    ].join('\n');
  }

  // ACT values check
  const toward: string[] = [];
  const away: string[] = [];
  for (const s of sentences) {
    if (/\b(didn't|skipped|avoided|put off|cancelled|stayed in|scrolled|ignored)\b/i.test(s)) away.push(s);
    else if (/\b(went|called|wrote|finished|helped|told|asked|ran|cooked|made|started)\b/i.test(s)) toward.push(s);
  }
  const valueNames = values.map((v) => v.label).join(', ') || 'your values';
  return [
    `Moving toward: ${toward.length ? toward.slice(0, 2).map((s) => quote(s, 70)).join(' / ') : 'nothing clearly named yet.'}`,
    `Moving away: ${away.length ? away.slice(0, 2).map((s) => quote(s, 70)).join(' / ') : 'nothing clearly named.'}`,
    `One small step: pick one of ${valueNames} and do a ten-minute version of it before tomorrow evening.`,
  ].join('\n');
}

export function heuristicSynthesis(blocks: Block[], t: Telemetry, values: CoreValue[]): { keyTakeaway: string; hiddenAssumption: string; microAction: string } {
  const charged = mostChargedSentence(blocks);
  const fused = findFusionSpans(blocks).filter((s) => !s.defused);

  const keyTakeaway = charged
    ? `The heart of this entry is: "${quote(charged, 110)}"`
    : 'This entry is still forming; there is no single centre yet.';

  const hiddenAssumption = fused.length
    ? `Possibly: that "${quote(fused[0].text, 70)}" is a fact rather than a thought (${patternName(fused[0].pattern).toLowerCase()}).`
    : t.ruminationFlag
      ? 'Possibly: that going over it again will produce an answer, when it may be keeping the loop running.'
      : t.avoidanceHits.length
        ? 'Possibly: that the uncomfortable feeling has to go away before you can act.'
        : 'Possibly: that how today felt says something fixed about how things will be.';

  // Written as if-then plans: naming the moment as well as the action makes a
  // plan far more likely to happen (Gollwitzer & Sheeran 2006).
  let microAction: string;
  if (t.avoidanceHits.length) microAction = "When I sit down after breakfast tomorrow, I'll spend ten timed minutes on the thing I put off, then stop.";
  else if (t.ruminationFlag) microAction = "When I make my first drink tomorrow, I'll write three sentences about this in the third person.";
  else if (t.coarseLabels.length) microAction = `When I next notice I'm feeling "${t.coarseLabels[0]}", I'll pause and name it more precisely before I act.`;
  else if (values[0]) microAction = `When I have ten free minutes tomorrow, I'll do one small thing for ${values[0].label.toLowerCase()}.`;
  else microAction = "When I notice a moment tomorrow where I feel most like myself, I'll jot down what I was doing.";

  return { keyTakeaway, hiddenAssumption, microAction };
}
