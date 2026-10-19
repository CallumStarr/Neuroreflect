import { DEFAULT_SETTINGS, getDB } from './db';
import { decodeVec, EMBED_MODEL, embed, encodeVec, hybridRank, type Doc } from './embeddings';
import { computeTelemetry } from './psych-engine';
import type { Chapter, Entry, Mention, Moment, NodeKind, Thread } from './types';
import { addDays, formatDay, localDayOf, uid } from './util';

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function clip(text: string, max = 220): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).replace(/[ ,;:.!?]+$/, '')}…`;
}

function monthKey(day: string): string {
  return day.slice(0, 7);
}

function weekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const week1 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((thursday.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

type ChunkRow = {
  id: string;
  entryId: string;
  localDay: string;
  blockId: string;
  start: number;
  end: number;
  vec: string;
  model: string;
};

function buildChunks(entry: Entry): ChunkRow[] {
  const out: ChunkRow[] = [];
  for (const b of entry.blocks) {
    const sents = splitSentences(b.text);
    if (!sents.length) continue;
    let start = 0;
    let i = 0;
    while (i < sents.length) {
      const batch = sents.slice(i, i + 2).join(' ');
      const text = clip(batch, 280);
      const pos = b.text.indexOf(batch, start);
      const s = pos >= 0 ? pos : start;
      const e = s + text.length;
      start = e;
      out.push({
        id: uid('mc'),
        entryId: entry.id,
        localDay: entry.localDay,
        blockId: b.id,
        start: s,
        end: e,
        vec: encodeVec(embed(text)),
        model: EMBED_MODEL,
      });
      i += 2;
    }
  }
  return out;
}

// What kind of moment a paragraph is. People are recognised from the
// paragraph's own mentions, never from a list of names.
function momentType(text: string, kinds: NodeKind[]): Moment['type'] {
  const t = text.toLowerCase();
  if (/\b(decide|decided|plan|planned|chose|commit|committed|going to|will)\b/.test(t)) return 'decision';
  if (/\b(learn|learned|learnt|reali[sz]e|reali[sz]ed|insight|noticed|understand|understood)\b/.test(t)) return 'insight';
  if (/\b(worried|worry|dread|anxious|afraid|fear|panic|stressed)\b/.test(t)) return 'worry';
  if (kinds.includes('person') || /@\w/.test(text)) return 'relationship';
  if (/\b(feel|felt|sad|angry|relief|ashamed|proud|happy)\b/.test(t)) return 'emotion';
  return 'event';
}

function buildMoments(entry: Entry, mentions: Mention[], kindOf: Map<string, NodeKind>, affect: Map<string, number>): Moment[] {
  const byBlock = new Map<string, Mention[]>();
  for (const m of mentions) {
    if (!m.blockId) continue;
    const list = byBlock.get(m.blockId) ?? [];
    list.push(m);
    byBlock.set(m.blockId, list);
  }
  const out: Moment[] = [];
  for (const b of entry.blocks) {
    const text = b.text.trim();
    if (!text) continue;
    const title = clip(splitSentences(text)[0] ?? text, 80);
    const nodeIds = [...new Set((byBlock.get(b.id) ?? []).map((m) => m.nodeId))];
    const id = uid('mo');
    // Negative affect of the whole paragraph, kept for thread trends only.
    affect.set(id, computeTelemetry([{ id: b.id, text }], DEFAULT_SETTINGS.thresholds).negAffectDensity);
    out.push({
      id,
      entryId: entry.id,
      localDay: entry.localDay,
      blockId: b.id,
      start: 0,
      end: text.length,
      type: momentType(
        text,
        nodeIds.map((n) => kindOf.get(n)).filter((k): k is NodeKind => !!k),
      ),
      title,
      text: clip(text, 340),
      importance: Math.max(1, Math.min(5, 1 + nodeIds.length + (/\b(always|never|ruined|worthless)\b/i.test(text) ? 2 : 0))),
      nodeIds,
      vec: encodeVec(embed(text)),
    });
  }
  return out;
}

function average(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// One thread per person, theme, value or pattern that appears in at least two
// entries. The trend compares the average negative affect of the passages about
// it in the latest entry with the average across the earlier entries. It is a
// crude lexical signal, so no trend is claimed from fewer than four entries.
const MIN_ENTRIES_FOR_TREND = 4;
async function buildThreads(moments: Moment[], affect: Map<string, number>, entryOrder: Map<string, string>): Promise<Thread[]> {
  const db = getDB();
  const nodes = await db.nodes.toArray();
  const nodeLabel = new Map(nodes.map((n) => [n.id, n.label]));
  const byNode = new Map<string, Moment[]>();
  for (const m of moments) {
    for (const n of m.nodeIds) {
      const list = byNode.get(n) ?? [];
      list.push(m);
      byNode.set(n, list);
    }
  }
  const threads: Thread[] = [];
  for (const [nodeId, list] of byNode) {
    const perEntry = new Map<string, number[]>();
    for (const m of list) perEntry.set(m.entryId, [...(perEntry.get(m.entryId) ?? []), affect.get(m.id) ?? 0]);
    const entries = [...perEntry.keys()].sort((a, b) => (entryOrder.get(a) ?? '').localeCompare(entryOrder.get(b) ?? ''));
    if (entries.length < 2) continue;
    const series = entries.map((id) => average(perEntry.get(id)!));
    const latest = series[series.length - 1];
    const before = average(series.slice(0, -1));
    const trend: Thread['trend'] = series.length < MIN_ENTRIES_FOR_TREND ? 'steady' : latest < before - 0.01 ? 'easing' : latest > before + 0.01 ? 'building' : 'steady';
    const days = list.map((m) => m.localDay).sort();
    const title = nodeLabel.get(nodeId) ?? 'Untitled';
    threads.push({
      id: uid('th'),
      title,
      momentIds: list.map((m) => m.id),
      entryIds: entries,
      nodeIds: [nodeId],
      firstDay: days[0],
      lastDay: days[days.length - 1],
      status: days[days.length - 1] >= localDayOf() ? 'active' : 'quiet',
      trend,
      summary: `${title} appears in ${entries.length} entries.`,
      negEarly: before,
      negLate: latest,
    });
  }
  return threads.sort((a, b) => b.entryIds.length - a.entryIds.length).slice(0, 40);
}

function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7;
  return addDays(day, -weekday);
}

function chapterTitle(kind: Chapter['kind'], key: string, anyDay: string): string {
  if (kind === 'month') return formatDay(`${key}-01`, { month: 'long', year: 'numeric' });
  return `Week of ${formatDay(mondayOf(anyDay), { day: 'numeric', month: 'short' })}`;
}

async function buildChapters(entries: Entry[]): Promise<Chapter[]> {
  const db = getDB();
  const [telemetry, forecasts, mentions, nodes, syntheses] = await Promise.all([
    db.telemetry.toArray(),
    db.forecasts.toArray(),
    db.mentions.toArray(),
    db.nodes.toArray(),
    db.syntheses.toArray(),
  ]);
  const synthesisOf = new Map(syntheses.map((s) => [s.entryId, s]));
  const byEntryTele = new Map(telemetry.map((t) => [t.entryId, t]));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const byKey = new Map<string, Entry[]>();
  for (const e of entries) {
    for (const key of [monthKey(e.localDay), weekKey(e.localDay)]) {
      const list = byKey.get(key) ?? [];
      list.push(e);
      byKey.set(key, list);
    }
  }
  const chapters: Chapter[] = [];
  for (const [key, group] of byKey) {
    if (!group.length) continue;
    const kind = key.includes('-W') ? 'week' : 'month';
    const ids = new Set(group.map((e) => e.id));
    const tel = group.map((e) => byEntryTele.get(e.id)).filter(Boolean);
    const words = group.reduce((s, e) => s + e.wordCount, 0);
    const mentionsIn = mentions.filter((m) => ids.has(m.entryId));
    const themes = new Map<string, number>();
    const people = new Map<string, number>();
    for (const m of mentionsIn) {
      const n = nodeById.get(m.nodeId);
      if (!n) continue;
      if (n.kind === 'theme') themes.set(n.label, (themes.get(n.label) ?? 0) + 1);
      if (n.kind === 'person') people.set(n.label, (people.get(n.label) ?? 0) + 1);
    }
    const errs = forecasts
      .filter((f) => f.calibratedAt && ids.has(f.entryId ?? '') && f.actualImpact !== null)
      .map((f) => f.predictedDread - (f.actualImpact ?? 0));
    const themeTop = [...themes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([label, count]) => ({ label, count }));
    const peopleTop = [...people.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([label, count]) => ({ label, count }));
    const basis = `${group.length}:${words}:${themeTop.map((t) => t.label).join(',')}`;
    // Carry forward only what you set yourself: the latest micro-action from this period.
    const latestAction = group
      .slice()
      .sort((a, b) => b.localDay.localeCompare(a.localDay))
      .map((e) => synthesisOf.get(e.id)?.microAction)
      .find((a): a is string => !!a);
    chapters.push({
      id: uid('ch'),
      kind,
      key,
      from: group.map((e) => e.localDay).sort()[0],
      to: group.map((e) => e.localDay).sort().slice(-1)[0],
      title: chapterTitle(kind, key, group[0].localDay),
      narrative: `You wrote ${group.length} entries (${words} words). Main themes: ${themeTop.map((t) => t.label).join(', ') || 'none yet'}.`,
      shifts: [
        `Average defusion ${average(tel.map((t) => t!.fusionScore)).toFixed(1)}/100`,
        `Granularity index ${average(tel.map((t) => t!.granularityIndex)).toFixed(1)}`,
      ],
      carryForward: latestAction ?? '',
      themes: themeTop,
      people: peopleTop,
      stats: {
        entries: group.length,
        words,
        avgDefusion: average(tel.map((t) => t!.fusionScore)),
        avgGranularity: average(tel.map((t) => t!.granularityIndex)),
        avgINeg: average(tel.map((t) => t!.negAffectDensity)),
        ruminationEntries: tel.filter((t) => t!.ruminationFlag).length,
        forecastErrorMean: errs.length ? average(errs) : null,
      },
      entryIds: group.map((e) => e.id),
      provider: 'heuristic',
      model: 'chapter-heuristic-v1',
      basis,
      createdAt: new Date().toISOString(),
    });
  }
  return chapters.sort((a, b) => a.key.localeCompare(b.key)).slice(-40);
}

/** True when finished entries exist but the search index is missing or was built by an older embedding. */
export async function memoryIsStale(): Promise<boolean> {
  const db = getDB();
  const complete = await db.entries.filter((e) => e.status === 'complete').count();
  if (!complete) return false;
  const sample = await db.memoryChunks.limit(1).first();
  return !sample || sample.model !== EMBED_MODEL;
}

export async function rebuildMemoryArtifacts(): Promise<void> {
  const db = getDB();
  const [entries, mentions] = await Promise.all([db.entries.filter((e) => e.status === 'complete').toArray(), db.mentions.toArray()]);
  const mentionByEntry = new Map<string, Mention[]>();
  for (const m of mentions) {
    const list = mentionByEntry.get(m.entryId) ?? [];
    list.push(m);
    mentionByEntry.set(m.entryId, list);
  }
  const kindOf = new Map((await db.nodes.toArray()).map((n) => [n.id, n.kind] as const));
  const entryOrder = new Map(entries.map((e) => [e.id, `${e.localDay}|${e.createdAt}`]));
  const affect = new Map<string, number>();
  const chunks: ChunkRow[] = [];
  const moments: Moment[] = [];
  for (const e of entries) {
    chunks.push(...buildChunks(e));
    moments.push(...buildMoments(e, mentionByEntry.get(e.id) ?? [], kindOf, affect));
  }
  const [threads, chapters] = await Promise.all([buildThreads(moments, affect, entryOrder), buildChapters(entries)]);
  await db.transaction('rw', [db.memoryChunks, db.moments, db.threads, db.chapters], async () => {
    await db.memoryChunks.clear();
    await db.moments.clear();
    await db.threads.clear();
    await db.chapters.clear();
    if (chunks.length) await db.memoryChunks.bulkAdd(chunks);
    if (moments.length) await db.moments.bulkAdd(moments);
    if (threads.length) await db.threads.bulkAdd(threads);
    if (chapters.length) await db.chapters.bulkAdd(chapters);
  });
}

export interface MemoryHit {
  chunkId: string;
  entryId: string;
  localDay: string;
  blockId: string;
  snippet: string;
  lexical: number;
  semantic: number;
  score: number;
}

export async function searchMemory(query: string, limit = 8): Promise<MemoryHit[]> {
  const q = query.trim();
  if (!q) return [];
  const db = getDB();
  const [chunks, entries] = await Promise.all([db.memoryChunks.toArray(), db.entries.toArray()]);
  const byEntry = new Map(entries.map((e) => [e.id, e]));
  const docs: Doc[] = chunks
    .map((c) => {
      const e = byEntry.get(c.entryId);
      const b = e?.blocks.find((x) => x.id === c.blockId);
      const text = b ? b.text.slice(c.start, c.end) : '';
      return { id: c.id, text, vec: decodeVec(c.vec) };
    })
    .filter((d) => d.text.trim().length > 0);
  const rank = hybridRank(docs, q, limit);
  const byChunk = new Map(chunks.map((c) => [c.id, c]));
  return rank
    .map((r) => {
      const c = byChunk.get(r.id);
      const e = c ? byEntry.get(c.entryId) : undefined;
      const b = c && e ? e.blocks.find((x) => x.id === c.blockId) : undefined;
      if (!c || !e || !b) return null;
      return {
        chunkId: c.id,
        entryId: c.entryId,
        localDay: c.localDay,
        blockId: c.blockId,
        snippet: clip(b.text.slice(c.start, c.end), 190),
        lexical: r.lexical,
        semantic: r.semantic,
        score: r.score,
      } satisfies MemoryHit;
    })
    .filter((x): x is MemoryHit => !!x);
}

export function summarizeThread(t: Thread): string {
  const n = t.entryIds.length;
  const base = `${t.title} comes up in ${n} entries`;
  if (n < MIN_ENTRIES_FOR_TREND) return `${base}, most recently on ${formatDay(t.lastDay)}.`;
  if (t.trend === 'easing') return `${base}; the latest entry about it was calmer than the earlier ones.`;
  if (t.trend === 'building') return `${base}; the latest entry about it carried more negative feeling than the earlier ones.`;
  return `${base}; the latest entry about it reads much like the earlier ones.`;
}

export function chapterByRecency(chapters: Chapter[]): Chapter[] {
  return chapters.slice().sort((a, b) => b.key.localeCompare(a.key));
}
