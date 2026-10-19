// Detector measurements against a labelled corpus, run with `npm test`.
//
// The corpus in validation-corpus.json is a placeholder: five rows, one of
// them a positive rumination example, cannot estimate accuracy. The harness is
// here so a real labelled set can be dropped in. To keep the numbers honest it
// follows three rules:
// - Labels describe the text, not what the engine can detect.
// - Tuned thresholds are only ever scored on rows left out of the tuning
//   (leave-one-out), never on the rows they were fitted to.
// - Rows in languages the lexicons do not cover are reported, not scored.
//
// It prints measurements and fails only on a malformed corpus: with this few
// rows, a pass or fail on accuracy would mean nothing.

import assert from 'node:assert/strict';
import corpus from './validation-corpus.json';
import { DEFAULT_SETTINGS } from '../lib/db';
import { computeTelemetry, findFusionSpans } from '../lib/psych-engine';
import type { RuminationThresholds } from '../lib/types';

type Row = { id: string; lang: string; text: string; rumination: boolean; fusionHigh: boolean };
type Counts = { tp: number; fp: number; fn: number; tn: number };

const SCORED_LANGS = new Set(['en']);
const MIN_PER_CLASS = 50;

const flagged = (r: Row, t: RuminationThresholds) => computeTelemetry([{ id: 'b', text: r.text }], t).ruminationFlag;
const fused = (r: Row) => findFusionSpans([{ id: 'b', text: r.text }]).some((s) => !s.defused);

function count(rows: Row[], predict: (r: Row) => boolean, truth: (r: Row) => boolean): Counts {
  const c: Counts = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const r of rows) {
    const p = predict(r);
    const y = truth(r);
    if (p && y) c.tp++;
    else if (p && !y) c.fp++;
    else if (!p && y) c.fn++;
    else c.tn++;
  }
  return c;
}

function describe(c: Counts): string {
  const precision = c.tp + c.fp ? (c.tp / (c.tp + c.fp)).toFixed(2) : 'n/a';
  const recall = c.tp + c.fn ? (c.tp / (c.tp + c.fn)).toFixed(2) : 'n/a';
  return `precision ${precision}, recall ${recall} (tp ${c.tp}, fp ${c.fp}, fn ${c.fn}, tn ${c.tn})`;
}

function f1(c: Counts): number {
  const p = c.tp / Math.max(1, c.tp + c.fp);
  const r = c.tp / Math.max(1, c.tp + c.fn);
  return p && r ? (2 * p * r) / (p + r) : 0;
}

const GRID: RuminationThresholds[] = [];
for (const minWords of [40, 60, 80, 100])
  for (const iTalk of [0.05, 0.08, 0.1, 0.12])
    for (const negAffect of [0.01, 0.02, 0.03, 0.04]) for (const cogProcMax of [0.01, 0.02, 0.03, 0.04]) GRID.push({ minWords, iTalk, negAffect, cogProcMax });

function tune(rows: Row[]): RuminationThresholds {
  let best = DEFAULT_SETTINGS.thresholds;
  let bestScore = -1;
  for (const t of GRID) {
    const score = f1(count(rows, (r) => flagged(r, t), (r) => r.rumination));
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

console.log('Validation measurements:');
const rows = corpus as Row[];

// The corpus must be well formed; this is the only thing that can fail.
assert.ok(rows.length > 0, 'empty corpus');
assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'duplicate ids');
for (const r of rows) {
  assert.ok(typeof r.text === 'string' && r.text.trim(), `${r.id}: no text`);
  assert.ok(typeof r.lang === 'string' && r.lang, `${r.id}: no language`);
  assert.equal(typeof r.rumination, 'boolean', `${r.id}: rumination label missing`);
  assert.equal(typeof r.fusionHigh, 'boolean', `${r.id}: fusion label missing`);
}

const scored = rows.filter((r) => SCORED_LANGS.has(r.lang));
const outside = rows.filter((r) => !SCORED_LANGS.has(r.lang));
const positives = scored.filter((r) => r.rumination).length;
console.log(`  corpus: ${scored.length} scored rows (${positives} rumination), ${outside.length} outside the lexicons' language`);
if (positives < MIN_PER_CLASS || scored.length - positives < MIN_PER_CLASS) {
  console.log(`  warning: fewer than ${MIN_PER_CLASS} rows per class, so none of the figures below estimates accuracy`);
}

console.log(`  rumination, app defaults: ${describe(count(scored, (r) => flagged(r, DEFAULT_SETTINGS.thresholds), (r) => r.rumination))}`);

// Leave-one-out: tune on all rows but one, then score only the row left out.
// A fold whose training rows lack either class cannot be tuned and is skipped.
const held: Counts = { tp: 0, fp: 0, fn: 0, tn: 0 };
let skipped = 0;
for (const r of scored) {
  const train = scored.filter((x) => x.id !== r.id);
  if (!train.some((x) => x.rumination) || train.every((x) => x.rumination)) {
    skipped++;
    continue;
  }
  const t = tune(train);
  const c = count([r], (x) => flagged(x, t), (x) => x.rumination);
  held.tp += c.tp;
  held.fp += c.fp;
  held.fn += c.fn;
  held.tn += c.tn;
}
console.log(`  rumination, tuned and scored on held-out rows: ${describe(held)}${skipped ? `; ${skipped} fold${skipped === 1 ? '' : 's'} skipped because the rest had only one class` : ''}`);

console.log(`  fusion: ${describe(count(scored, fused, (r) => r.fusionHigh))}`);
for (const r of outside) {
  console.log(`  ${r.id} (${r.lang}) not scored: rumination flagged ${flagged(r, DEFAULT_SETTINGS.thresholds)}, fusion found ${fused(r)}, labels say ${r.rumination}/${r.fusionHigh}`);
}

console.log('\nValidation measurements done (corpus well formed)');
