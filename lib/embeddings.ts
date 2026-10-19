// Offline text embeddings and hybrid search. No model download and no network:
// words are stemmed, mapped onto the emotion and theme concepts the engine
// already knows, then hashed into a fixed-size vector. Search blends this
// semantic-ish score with BM25 so exact names and rare words still win.
// It is lighter than a neural embedding; the `model` field on every stored
// vector lets a neural model replace it later without touching callers.

import { EMOTION_FAMILIES, THEME_KEYWORDS } from './lexicons';
import { fromB64, toB64 } from './util';

// v2: question words and generic verbs are stop words, and stemming handles
// irregular forms and doubled consonants (slept, running, planned).
export const EMBED_MODEL = 'hash-concept-v2';
export const EMBED_DIMS = 384;

const STOP = new Set(
  ('a an and are as at be been but by for from had has have he her his i in is it its me my of on or our she so that the their them then ' +
    'there they this to was we were what when which who will with would you your am do did does just not no yes if than too very can could ' +
    'should about into over out up down more most some any all also really still even much many get got going go went one two ' +
    // Question words and generic verbs that carry no topic.
    'how where why who whom whose does show shows showed thing things feel feels felt feeling ever often lately recently usually kind sort way').split(' '),
);

// Irregular forms and comparatives that suffix rules cannot reach.
const IRREGULAR: Record<string, string> = {
  slept: 'sleep',
  thought: 'think',
  taught: 'teach',
  wrote: 'write',
  written: 'write',
  said: 'say',
  told: 'tell',
  spoke: 'speak',
  ran: 'run',
  ate: 'eat',
  drank: 'drink',
  lost: 'lose',
  met: 'meet',
  fought: 'fight',
  froze: 'freeze',
  frozen: 'freeze',
  cried: 'cry',
  tried: 'try',
  worried: 'worry',
  learnt: 'learn',
  better: 'good',
  best: 'good',
  worse: 'bad',
  worst: 'bad',
};

export function stem(word: string): string {
  const irregular = IRREGULAR[word];
  if (irregular) return irregular;
  let w = word;
  let cut = false;
  if (w.length > 5 && w.endsWith('ing')) {
    w = w.slice(0, -3);
    cut = true;
  } else if (w.length > 4 && w.endsWith('ed')) {
    w = w.slice(0, -2);
    cut = true;
  } else if (w.length > 4 && w.endsWith('ly')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  // running -> run, planned -> plan (but not fall, miss, buzz).
  if (cut && /([^aeiouylsz])\1$/.test(w)) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

export function terms(text: string): string[] {
  const raw = text.toLowerCase().replace(/[’‘]/g, "'").match(/[a-z0-9À-ɏ]+/g) ?? [];
  return raw.filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

// Concept features: every word of an emotion term or theme keyword points at
// its family or theme, so "dread" and "uneasy" land near each other.
const CONCEPT = new Map<string, string[]>();
function addConcept(word: string, concept: string) {
  for (const part of word.toLowerCase().split(/\s+/)) {
    const key = stem(part);
    if (STOP.has(part) || key.length < 3) continue;
    const list = CONCEPT.get(key) ?? [];
    if (!list.includes(concept)) list.push(concept);
    CONCEPT.set(key, list);
  }
}
for (const fam of EMOTION_FAMILIES) for (const t of fam.terms) addConcept(t, `emo:${fam.id}`);
for (const [theme, words] of Object.entries(THEME_KEYWORDS)) for (const w of words) addConcept(w, `theme:${theme.toLowerCase()}`);

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type Vec = Float32Array;

export function embed(text: string): Vec {
  const v = new Float32Array(EMBED_DIMS);
  const ts = terms(text);
  const add = (feature: string, weight: number) => {
    const h = hash(feature);
    v[h % EMBED_DIMS] += (h & 0x80000000 ? -1 : 1) * weight;
  };
  const counts = new Map<string, number>();
  for (const t of ts) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const [t, c] of counts) add(`w:${t}`, 1 + Math.log(c));
  for (let i = 0; i < ts.length - 1; i++) add(`b:${ts[i]}_${ts[i + 1]}`, 0.6);
  for (const t of counts.keys()) for (const c of CONCEPT.get(t) ?? []) add(`c:${c}`, 1.4);
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

export function cosine(a: Vec, b: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function encodeVec(v: Vec): string {
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(v[i] * 127)));
  return toB64(new Uint8Array(q.buffer));
}

export function decodeVec(s: string): Vec {
  const bytes = fromB64(s);
  const q = new Int8Array(bytes.buffer, 0, bytes.length);
  const v = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) v[i] = q[i] / 127;
  return v;
}

// ---------- BM25 ----------

export interface Doc {
  id: string;
  text: string;
  vec: Vec;
}

export interface Scored {
  id: string;
  score: number;
  lexical: number;
  semantic: number;
}

const K1 = 1.4;
const B = 0.75;

export function bm25(docs: { id: string; terms: string[] }[], query: string[]): Map<string, number> {
  const N = docs.length || 1;
  const avg = docs.reduce((s, d) => s + d.terms.length, 0) / N || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d.terms)) df.set(t, (df.get(t) ?? 0) + 1);
  const out = new Map<string, number>();
  const q = [...new Set(query)];
  for (const d of docs) {
    const tf = new Map<string, number>();
    for (const t of d.terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.terms.length) / avg));
    }
    if (s > 0) out.set(d.id, s);
  }
  return out;
}

/**
 * Reciprocal-rank fusion of the lexical and semantic rankings. Rank fusion
 * needs no score calibration between the two, which differ in scale.
 */
export function hybridRank(docs: Doc[], query: string, limit = 8): Scored[] {
  if (!docs.length || !query.trim()) return [];
  const qTerms = terms(query);
  const qVec = embed(query);
  const lex = bm25(
    docs.map((d) => ({ id: d.id, terms: terms(d.text) })),
    qTerms,
  );
  const sem = new Map<string, number>();
  for (const d of docs) sem.set(d.id, cosine(qVec, d.vec));

  const rank = (m: Map<string, number>, min: number) =>
    new Map([...m.entries()].filter(([, s]) => s > min).sort((a, b) => b[1] - a[1]).map(([id], i) => [id, i + 1] as const));
  const lexRank = rank(lex, 0);
  const semRank = rank(sem, 0.12);

  const K = 20;
  const ids = new Set([...lexRank.keys(), ...semRank.keys()]);
  const scored: Scored[] = [];
  for (const id of ids) {
    const l = lexRank.get(id);
    const s = semRank.get(id);
    scored.push({
      id,
      score: (l ? 1 / (K + l) : 0) + (s ? 1 / (K + s) : 0),
      lexical: lex.get(id) ?? 0,
      semantic: sem.get(id) ?? 0,
    });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
