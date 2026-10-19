// Engine checks run with `npm test`. No browser needed.
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../lib/db';
import { heuristicLens, heuristicSocratic, heuristicSynthesis } from '../lib/heuristic-copilot';
import { enforceSingleQuestion } from '../lib/orchestrator';
import { computeTelemetry, extractEntities, findCoarseLabels, findFusionSpans, heuristicValueAlignment, nextRuminationState } from '../lib/psych-engine';
import { ENTRIES } from '../lib/seed';
import type { Block, CoreValue } from '../lib/types';

const T = DEFAULT_SETTINGS.thresholds;
const toBlocks = (ps: string[]): Block[] => ps.map((text, i) => ({ id: `b${i}`, text }));
let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${(e as Error).message}`);
  }
}

console.log('Seed entry telemetry:');
for (const e of ENTRIES) {
  const t = computeTelemetry(toBlocks(e.paragraphs), T);
  console.log(
    `  ${e.title.padEnd(44)} words=${String(t.wordCount).padStart(3)} i=${(t.iTalkDensity * 100).toFixed(1)}% neg=${(t.negAffectDensity * 100).toFixed(1)}% cog=${(t.cogProcDensity * 100).toFixed(1)}% fusion=${t.fusionScore} gran=${t.granularityIndex.toFixed(1)} avoid=${t.avoidanceHits.length} coarse=[${t.coarseLabels}] rumination=${t.ruminationFlag}`,
  );
}

const values: CoreValue[] = [
  { id: 'v1', label: 'Growth', description: 'Learning, stretching beyond comfort', order: 0 },
  { id: 'v2', label: 'Connection', description: 'Showing up for Sam and family', order: 1 },
  { id: 'v3', label: 'Health', description: 'Sleep, movement and food', order: 2 },
];

console.log('\nChecks:');
check('only the review-meeting entry trips the rumination circuit-breaker', () => {
  const flags = ENTRIES.map((e) => computeTelemetry(toBlocks(e.paragraphs), T).ruminationFlag);
  assert.deepEqual(flags, [false, false, true, false]);
});

check('rumination needs more than 100 words', () => {
  const short = toBlocks(['I am useless. I hate this. I feel awful and stupid and stuck.']);
  assert.equal(computeTelemetry(short, T).ruminationFlag, false);
});

check('a fresh high I-talk negative entry triggers in real time', () => {
  const text =
    'I feel awful. I hate myself today. I messed up again at work and I feel so stupid. I am useless and everyone thinks I am pathetic. I keep replaying it. I feel sick and tired and stuck. My head hurts. I am angry at myself. I feel worthless. I cried in the car. I hate that I am like this. I feel like a failure and I am exhausted. I am scared it will happen again tomorrow. I feel hopeless. I just feel bad and miserable and alone tonight and I hate it. I keep going over the same moment in my head again and again. I feel so tense and upset and I am sick of feeling like this every single night.';
  const t = computeTelemetry(toBlocks([text]), T);
  assert.ok(t.wordCount > 100, `words ${t.wordCount}`);
  assert.equal(t.ruminationFlag, true);
});

check('causal language keeps a sad entry out of the loop', () => {
  const text =
    'I feel sad today because the move fell through, although I understand why the landlord chose someone else. I realise I had pinned a lot on it, and perhaps that is why it hurts so much. Looking back, I could have asked more questions earlier. I wonder whether I was rushing because I felt stuck at home. It makes sense that I am disappointed. Maybe the reason I keep thinking about it is that I wanted a fresh start, and I might find that another way. I notice the pattern of putting all my hope in one option, and I want to learn from it so that next time I keep two or three going. I feel tired but I understand the situation better now and I can see a way forward with a bit of perspective.';
  const t = computeTelemetry(toBlocks([text]), T);
  assert.ok(t.wordCount > 100);
  assert.equal(t.ruminationFlag, false, `cog ${(t.cogProcDensity * 100).toFixed(1)}%`);
});

check('fusion: global self-label and mind reading are detected', () => {
  const spans = findFusionSpans(toBlocks(["I'm such a failure. Everyone thinks I'm useless."]));
  const kinds = spans.map((s) => s.pattern).sort();
  assert.deepEqual(kinds, ['mind_read', 'overgeneralise']);
  assert.ok(spans.every((s) => !s.defused));
});

check('fusion: the same thought framed metacognitively counts as defused', () => {
  const fused = computeTelemetry(toBlocks(['I always mess things up.']), T);
  const defused = computeTelemetry(toBlocks(["I'm noticing the thought that I always mess things up."]), T);
  assert.equal(fused.fusedCount, 1);
  assert.equal(defused.fusedCount, 0);
  assert.ok(defused.fusionScore > fused.fusionScore, `${defused.fusionScore} > ${fused.fusionScore}`);
  assert.equal(defused.fusionScore, 100);
});

check('coarse labels only flagged when used as feelings', () => {
  const spans = findCoarseLabels(toBlocks(['I feel stressed. The coffee was good. I was so tired. Not a bad idea.']));
  assert.deepEqual(spans.map((s) => s.word.toLowerCase()), ['stressed', 'tired']);
});

check('granularity counts distinct fine labels per 1000 words', () => {
  const t = computeTelemetry(toBlocks(['I felt anticipatory dread and some boundary resentment, then relief.']), T);
  assert.deepEqual(t.fineLabels.sort(), ['anticipatory dread', 'boundary resentment', 'relief']);
  assert.ok(Math.abs(t.granularityIndex - (3 / t.wordCount) * 1000) < 1e-9);
});

check('avoidance cues are picked up', () => {
  const t = computeTelemetry(toBlocks(['I cancelled the gym and scrolled until 2am. I did not want to think about it.']), T);
  assert.ok(t.avoidanceHits.includes('cancelled'));
  assert.ok(t.avoidanceHits.includes('scrolled'));
});

check('entities: explicit tags, known people and patterns', () => {
  const blocks = toBlocks(['Had lunch with @Sam and talked about #work. Priya emailed. $growth', 'I am such a failure.']);
  const t = computeTelemetry(blocks, T);
  const ents = extractEntities(blocks, ['Priya'], values, t);
  const labels = ents.map((e) => `${e.kind}:${e.label}`);
  for (const want of ['person:Sam', 'theme:Work', 'value:Growth', 'person:Priya', 'distortion:Global self-label']) {
    assert.ok(labels.includes(want), `missing ${want} in ${labels.join(', ')}`);
  }
});

check('values alignment: approach scores up, drift scores down', () => {
  const res = heuristicValueAlignment(toBlocks(['I went for a run and slept well. I skipped calling my mum again.']), values);
  const by = Object.fromEntries(res.map((r) => [r.valueId, r.score]));
  assert.ok(by.v3 > 0, `health ${by.v3}`);
  assert.ok(by.v2 < 0, `connection ${by.v2}`);
  assert.equal(by.v1, 0);
});

check('value synonyms match whole words only ("Sam" is not "same")', () => {
  const vals: CoreValue[] = [{ id: 'c', label: 'Connection', description: 'Showing up for Sam, family and friends', order: 0 }];
  const res = heuristicValueAlignment(toBlocks(['I keep going over the same moment in my head again and again.']), vals);
  assert.equal(res[0].evidence, 'Not mentioned in this entry.');
});

check('filler words in a value description are not used as matches', () => {
  const vals: CoreValue[] = [{ id: 'h', label: 'Honesty', description: 'Saying what I actually think, kindly', order: 0 }];
  const res = heuristicValueAlignment(toBlocks(["Everyone thinks I'm useless and I actually believe it."]), vals);
  assert.equal(res[0].evidence, 'Not mentioned in this entry.');
});

check('inflected synonyms still match (practise -> practised)', () => {
  const vals: CoreValue[] = [{ id: 'g', label: 'Growth', description: '', order: 0 }];
  const res = heuristicValueAlignment(toBlocks(['I practised the talk twice and finished the slides.']), vals);
  assert.ok(res[0].score > 0, `score ${res[0].score}`);
});

check('a theme with the same name as a core value folds into the value', () => {
  const blocks = toBlocks(['Went to the gym and then for a long walk. #health']);
  const t = computeTelemetry(blocks, T);
  const ents = extractEntities(blocks, [], [{ id: 'v', label: 'Health', description: '', order: 0 }], t);
  const labels = ents.map((e) => `${e.kind}:${e.label}`);
  assert.ok(labels.includes('value:Health'), labels.join(', '));
  assert.ok(!labels.includes('theme:Health'), labels.join(', '));
});

check('rumination hysteresis needs two clear passes to switch off', () => {
  let s = nextRuminationState(false, 0, true);
  assert.equal(s.active, true);
  s = nextRuminationState(s.active, s.clearPasses, false);
  assert.equal(s.active, true);
  s = nextRuminationState(s.active, s.clearPasses, false);
  assert.equal(s.active, false);
});

check('single-question enforcement keeps only the first question', () => {
  assert.equal(enforceSingleQuestion('That sounds hard. What mattered most? And why?'), 'What mattered most?');
});

check('heuristic co-pilot produces a question, lens and synthesis', () => {
  const blocks = toBlocks(ENTRIES[2].paragraphs);
  const t = computeTelemetry(blocks, T);
  const q = heuristicSocratic(blocks, t, []);
  assert.ok(q.endsWith('?'), q);
  for (const lens of ['stoic', 'first_principles', 'cbt', 'act'] as const) {
    assert.ok(heuristicLens(lens, blocks, t, values).split('\n').length >= 3);
  }
  const syn = heuristicSynthesis(blocks, t, values);
  assert.ok(syn.keyTakeaway && syn.hiddenAssumption && syn.microAction);
});

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
