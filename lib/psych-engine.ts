// Deterministic psychological telemetry. Runs entirely in the browser on every
// typing pause. No LLM is involved in any number shown on the dashboard.

import {
  APPROACH_MARKERS,
  AVOIDANCE_PHRASES,
  COARSE_LABELS,
  COARSE_TO_FAMILIES,
  COGNITIVE_PHRASES,
  COGNITIVE_PROCESSING,
  DEFUSION_PHRASES,
  DRIFT_MARKERS,
  EMOTION_FAMILIES,
  FINE_LABELS,
  FIRST_PERSON_SINGULAR,
  FUSION_RULES,
  FUTURE_EVENT_CUES,
  NEGATIVE_AFFECT,
  POSITIVE_AFFECT,
  RELATIONAL_PEOPLE,
  THEME_KEYWORDS,
  VALUE_SYNONYMS,
  type FusionPattern,
} from './lexicons';
import type { Block, CoreValue, RuminationThresholds, Telemetry } from './types';
import { clamp } from './util';

export const ENGINE_VERSION = '1.0.0';

// Names of the two pattern nodes. Earlier versions called them "Rumination
// loop" and "Experiential avoidance"; lib/migrations.ts renames stored nodes.
export const CIRCLING_LABEL = 'Circling';
export const AVOIDANCE_LABEL = 'Avoidance';

// ---------- tokenising ----------

function normalise(text: string): string {
  return text.replace(/[’‘]/g, "'").toLowerCase();
}

export function tokenize(text: string): string[] {
  return normalise(text).match(/[a-z0-9À-ɏ]+(?:'[a-z]+)?/g) ?? [];
}

export function buildMatcher(list: string[]): (word: string) => boolean {
  const exact = new Set<string>();
  const stems: string[] = [];
  for (const w of list) {
    if (w.endsWith('*')) stems.push(w.slice(0, -1));
    else exact.add(w);
  }
  return (word) => exact.has(word) || stems.some((s) => word.startsWith(s));
}

const isFirstPerson = buildMatcher(FIRST_PERSON_SINGULAR);
const isNegative = buildMatcher(NEGATIVE_AFFECT);
const isPositive = buildMatcher(POSITIVE_AFFECT);
const isCognitive = buildMatcher(COGNITIVE_PROCESSING);

function countPhrase(haystack: string, phrase: string): number {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}`, 'g');
  return (haystack.match(re) ?? []).length;
}

// ---------- spans (for inline highlights) ----------

export interface FusionSpan {
  blockId: string;
  start: number;
  end: number;
  text: string;
  pattern: FusionPattern;
  defused: boolean;
  reframe: string;
}

export interface LabelSpan {
  blockId: string;
  start: number;
  end: number;
  word: string;
}

function sentenceStart(text: string, index: number): number {
  const before = text.slice(0, index);
  const m = before.match(/.*[.!?](?:\s|$)/s);
  return m ? m[0].length : 0;
}

const PATTERN_NAMES: Record<FusionPattern, string> = {
  absolutist: 'Absolutist thinking',
  overgeneralise: 'Global self-label',
  catastrophise: 'Catastrophising',
  mind_read: 'Mind reading',
};

export function patternName(p: FusionPattern): string {
  return PATTERN_NAMES[p];
}

export function suggestReframe(span: string, pattern: FusionPattern): string {
  const clean = span.trim().replace(/[.!?]+$/, '');
  switch (pattern) {
    case 'mind_read':
      return `I'm noticing a guess about what others think: "${clean}". What do I actually know?`;
    case 'catastrophise':
      return `I'm having the thought that ${lowerFirst(clean)}. What is the most likely outcome, not the worst?`;
    case 'overgeneralise':
      return `I'm noticing the thought that ${lowerFirst(clean)}. That is a label, not a fact about every part of me.`;
    case 'absolutist':
    default:
      return `I'm noticing the thought that ${lowerFirst(clean)}. Is it really always, or just often lately?`;
  }
}

function lowerFirst(s: string): string {
  if (/^I\b/.test(s)) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function findFusionSpans(blocks: Block[]): FusionSpan[] {
  const spans: FusionSpan[] = [];
  for (const block of blocks) {
    const lower = normalise(block.text);
    const taken: [number, number][] = [];
    for (const rule of FUSION_RULES) {
      rule.regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.regex.exec(lower)) !== null) {
        const start = m.index;
        const end = start + m[0].trimEnd().length;
        if (taken.some(([a, b]) => start < b && end > a)) continue;
        taken.push([start, end]);
        const sStart = sentenceStart(lower, start);
        const prefix = lower.slice(sStart, start);
        const defused = DEFUSION_PHRASES.some((p) => prefix.includes(p));
        const original = block.text.slice(start, end);
        spans.push({
          blockId: block.id,
          start,
          end,
          text: original,
          pattern: rule.pattern,
          defused,
          reframe: suggestReframe(original, rule.pattern),
        });
      }
    }
  }
  return spans.sort((a, b) => (a.blockId === b.blockId ? a.start - b.start : 0));
}

const FEELING_CONTEXT =
  /(?:\bi(?:'m| am| was| feel| felt|'ve been| have been| had been| keep feeling| get| got)|\bfeel(?:s|ing)?|\bfelt)(?:\s+(?:so|really|pretty|quite|just|a bit|a little|kind of|kinda|very|totally|completely|super|rather|fairly|still|bloody|incredibly|a bit too))*\s+$/;

export function findCoarseLabels(blocks: Block[]): LabelSpan[] {
  const out: LabelSpan[] = [];
  const re = new RegExp(`\\b(${COARSE_LABELS.join('|')})\\b`, 'gi');
  for (const block of blocks) {
    const lower = normalise(block.text);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) {
      const word = m[1];
      // Only flag words describing the writer's own state: "I felt bad", "I'm fine",
      // "feeling a bit off", "I was so tired". "The coffee was good" is not a feeling.
      const before = lower.slice(Math.max(0, m.index - 40), m.index);
      if (!FEELING_CONTEXT.test(before)) continue;
      out.push({ blockId: block.id, start: m.index, end: m.index + word.length, word: block.text.slice(m.index, m.index + word.length) });
    }
  }
  return out;
}

export function findFineLabels(text: string): string[] {
  const lower = normalise(text);
  const found = new Set<string>();
  for (const term of FINE_LABELS) {
    const re = new RegExp(`\\b${term.replace(/[-]/g, '[- ]')}\\b`, 'i');
    if (re.test(lower)) found.add(term);
  }
  return [...found];
}

export function familiesForCoarse(word: string) {
  const ids = COARSE_TO_FAMILIES[word.toLowerCase()] ?? [];
  const primary = EMOTION_FAMILIES.filter((f) => ids.includes(f.id));
  const rest = EMOTION_FAMILIES.filter((f) => !ids.includes(f.id));
  return { primary, rest };
}

// ---------- main telemetry ----------

export function computeTelemetry(blocks: Block[], thresholds: RuminationThresholds): Telemetry {
  const text = blocks.map((b) => b.text).join('\n');
  const lower = normalise(text);
  const tokens = tokenize(text);
  const n = tokens.length;
  const safe = Math.max(n, 1);

  let iTalk = 0;
  let neg = 0;
  let pos = 0;
  let cog = 0;
  for (const t of tokens) {
    if (isFirstPerson(t)) iTalk++;
    if (isNegative(t)) neg++;
    if (isPositive(t)) pos++;
    if (isCognitive(t)) cog++;
  }
  for (const p of COGNITIVE_PHRASES) cog += countPhrase(lower, p);

  const fusion = findFusionSpans(blocks);
  const fusedCount = fusion.filter((s) => !s.defused).length;
  // Metacognitive framing, counted at most once per sentence so overlapping
  // phrases ("I'm having the thought that") don't double-score.
  const defusedCount = lower
    .split(/(?<=[.!?\n])\s*/)
    .filter((s) => DEFUSION_PHRASES.some((p) => s.includes(p))).length;

  const fusionScore = Math.round(100 - clamp(fusedCount * 12 - defusedCount * 15, 0, 100));

  const avoidanceHits: string[] = [];
  for (const p of AVOIDANCE_PHRASES) {
    if (countPhrase(lower, p) > 0) avoidanceHits.push(p);
  }
  const avoidanceCount = AVOIDANCE_PHRASES.reduce((acc, p) => acc + countPhrase(lower, p), 0);

  const fineLabels = findFineLabels(text);
  const coarseLabels = [...new Set(findCoarseLabels(blocks).map((l) => l.word.toLowerCase()))];
  const granularityIndex = n > 0 ? (fineLabels.length / n) * 1000 : 0;

  const iTalkDensity = iTalk / safe;
  const negAffectDensity = neg / safe;
  const cogProcDensity = cog / safe;

  const ruminationFlag =
    n > thresholds.minWords &&
    iTalkDensity > thresholds.iTalk &&
    negAffectDensity > thresholds.negAffect &&
    cogProcDensity < thresholds.cogProcMax;

  return {
    wordCount: n,
    iTalkDensity,
    negAffectDensity,
    posAffectDensity: pos / safe,
    cogProcDensity,
    fusionScore,
    fusedCount,
    defusedCount,
    avoidanceDensity: avoidanceCount / safe,
    avoidanceHits,
    granularityIndex,
    fineLabels,
    coarseLabels,
    ruminationFlag,
  };
}

// Hysteresis wrapper: entering is immediate, leaving needs two clear passes in a row.
export function nextRuminationState(prevActive: boolean, prevClearPasses: number, flag: boolean): { active: boolean; clearPasses: number } {
  if (flag) return { active: true, clearPasses: 0 };
  if (!prevActive) return { active: false, clearPasses: 0 };
  const clear = prevClearPasses + 1;
  return clear >= 2 ? { active: false, clearPasses: 0 } : { active: true, clearPasses: clear };
}

export function detectFutureEvent(text: string): boolean {
  return FUTURE_EVENT_CUES.test(text);
}

// ---------- entity extraction ----------

export interface ExtractedEntity {
  kind: 'person' | 'theme' | 'value' | 'distortion' | 'pattern';
  label: string;
  blockId: string | null;
  start: number;
  end: number;
  source: 'explicit_tag' | 'heuristic';
}

function titleCase(s: string): string {
  return s
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function extractEntities(blocks: Block[], knownPeople: string[], coreValues: CoreValue[], telemetry: Telemetry): ExtractedEntity[] {
  const out: ExtractedEntity[] = [];
  const seen = new Set<string>();
  const valueNames = new Set(coreValues.map((v) => v.label.toLowerCase()));
  const push = (e: ExtractedEntity) => {
    const key = `${e.kind}:${e.label.toLowerCase()}`;
    if (e.source === 'heuristic' && seen.has(key)) return;
    seen.add(key);
    out.push(e);
  };

  for (const block of blocks) {
    const text = block.text;
    // Explicit tags: @Person, #Theme, $Value. Underscores or hyphens join words.
    const tagRe = /(^|\s)([@#$])([A-Za-z][\w-]*)/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(text)) !== null) {
      const sigil = m[2];
      const raw = m[3];
      const start = m.index + m[1].length;
      const kind = sigil === '@' ? 'person' : sigil === '#' ? 'theme' : 'value';
      push({ kind, label: titleCase(raw), blockId: block.id, start, end: start + 1 + raw.length, source: 'explicit_tag' });
    }

    const lower = normalise(text);
    // Known people mentioned by name without the @.
    for (const person of knownPeople) {
      const re = new RegExp(`\\b${person.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      let pm: RegExpExecArray | null;
      while ((pm = re.exec(lower)) !== null) {
        if (pm.index > 0 && text[pm.index - 1] === '@') continue;
        push({ kind: 'person', label: person, blockId: block.id, start: pm.index, end: pm.index + person.length, source: 'heuristic' });
      }
    }
    // Relational nouns: "my mum", "my manager".
    const relRe = new RegExp(`\\bmy (${RELATIONAL_PEOPLE.join('|')})\\b`, 'g');
    let rm: RegExpExecArray | null;
    while ((rm = relRe.exec(lower)) !== null) {
      const word = rm[1];
      const start = rm.index + 3;
      push({ kind: 'person', label: titleCase(word), blockId: block.id, start, end: start + word.length, source: 'heuristic' });
    }
    // Themes from keyword families. A theme that shares a name with one of the
    // person's core values is represented by the value instead, not twice.
    const tokens = new Set(tokenize(text));
    for (const [theme, words] of Object.entries(THEME_KEYWORDS)) {
      if (valueNames.has(theme.toLowerCase())) continue;
      if (words.some((w) => tokens.has(w))) push({ kind: 'theme', label: theme, blockId: block.id, start: 0, end: 0, source: 'heuristic' });
    }
  }

  // Core values referenced implicitly.
  const all = normalise(blocks.map((b) => b.text).join(' '));
  for (const v of coreValues) {
    const syns = valueSynonyms(v);
    if (syns.some((s) => mentionsTerm(all, s))) push({ kind: 'value', label: v.label, blockId: null, start: 0, end: 0, source: 'heuristic' });
  }
  // Explicit #Theme tags that name a core value become value mentions too.
  for (const e of out) {
    if (e.kind === 'theme' && valueNames.has(e.label.toLowerCase())) e.kind = 'value';
  }

  // Psychological patterns become nodes too, so they can be traced over time.
  for (const span of findFusionSpans(blocks)) {
    if (!span.defused) push({ kind: 'distortion', label: patternName(span.pattern), blockId: span.blockId, start: span.start, end: span.end, source: 'heuristic' });
  }
  if (telemetry.ruminationFlag) push({ kind: 'pattern', label: CIRCLING_LABEL, blockId: null, start: 0, end: 0, source: 'heuristic' });
  if (telemetry.avoidanceHits.length >= 2) push({ kind: 'pattern', label: AVOIDANCE_LABEL, blockId: null, start: 0, end: 0, source: 'heuristic' });

  return out;
}

// Words from a value's description that carry no meaning of their own.
const DESCRIPTION_STOPWORDS = new Set([
  'about', 'actually', 'always', 'being', 'beyond', 'could', 'doing', 'every', 'feeling', 'getting', 'going', 'having',
  'kindly', 'making', 'other', 'really', 'saying', 'should', 'showing', 'something', 'support', 'their', 'there',
  'thing', 'things', 'think', 'through', 'where', 'which', 'would', 'myself', 'people', 'someone', 'stretching',
]);

export function valueSynonyms(v: CoreValue): string[] {
  const key = v.label.toLowerCase();
  const base = VALUE_SYNONYMS[key] ?? [];
  const fromDesc = tokenize(v.description).filter((w) => w.length > 4 && !DESCRIPTION_STOPWORDS.has(w));
  return [...new Set([key, ...base, ...fromDesc])];
}

// Whole-word match allowing simple inflections, so "sam" never matches "same"
// but "practise" still matches "practised".
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
export function mentionsTerm(lowerText: string, term: string): boolean {
  return new RegExp(`\\b${escapeRe(term)}(?:s|es|d|ed|ing)?\\b`).test(lowerText);
}

// ---------- values alignment (heuristic fallback) ----------

export interface AlignmentResult {
  valueId: string;
  score: number;
  evidence: string;
}

export function heuristicValueAlignment(blocks: Block[], values: CoreValue[]): AlignmentResult[] {
  const text = blocks.map((b) => b.text).join(' ');
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  return values.map((v) => {
    const syns = valueSynonyms(v);
    let score = 0;
    let evidence = '';
    let hits = 0;
    for (const s of sentences) {
      const ls = normalise(s);
      if (!syns.some((w) => mentionsTerm(ls, w))) continue;
      hits++;
      const approach = APPROACH_MARKERS.some((a) => new RegExp(`\\b${escapeRe(a)}\\b`).test(ls));
      const drift = DRIFT_MARKERS.some((d) => new RegExp(`\\b${escapeRe(d)}\\b`).test(ls));
      if (drift && !approach) score -= 1;
      else if (approach && !drift) score += 1;
      if (!evidence || (drift || approach)) evidence = s.trim();
    }
    return {
      valueId: v.id,
      score: clamp(score, -2, 2),
      evidence: hits ? evidence.slice(0, 220) : 'Not mentioned in this entry.',
    };
  });
}

// ---------- heuristic text helpers used by the fallback co-pilot ----------

export function mostChargedSentence(blocks: Block[]): string {
  const text = blocks.map((b) => b.text).join(' ');
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => tokenize(s).length >= 4);
  let best = sentences[0] ?? '';
  let bestScore = -1;
  for (const s of sentences) {
    const toks = tokenize(s);
    const score = toks.filter((t) => isNegative(t) || isPositive(t)).length * 2 + toks.filter(isFirstPerson).length;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best.trim();
}

export function lastSentence(blocks: Block[]): string {
  const text = blocks.map((b) => b.text).join(' ').trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  return (sentences[sentences.length - 1] ?? '').trim();
}
