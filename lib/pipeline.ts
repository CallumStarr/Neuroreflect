// Entry persistence, completion pipeline and knowledge-graph maintenance.
// Order follows the spec: persist first, then run independent jobs so one
// failure never blocks the rest.

import { getDB, loadSettings } from './db';
import { ENGINE_VERSION, computeTelemetry, extractEntities, heuristicValueAlignment } from './psych-engine';
import { runLLMAlignment, runSynthesis } from './orchestrator';
import { rebuildMemoryArtifacts } from './memory';
import type { AppSettings, Block, Entry, GraphNode, Mention, NodeKind, Telemetry, TelemetrySnapshot } from './types';
import { blocksToText, countWords, localDayOf, uid } from './util';

export function newEntry(day: string = localDayOf()): Entry {
  const now = new Date().toISOString();
  return {
    id: uid('e'),
    title: '',
    createdAt: now,
    updatedAt: now,
    localDay: day,
    status: 'draft',
    blocks: [{ id: uid('b'), text: '' }],
    wordCount: 0,
    activeSeconds: 0,
    inputSources: ['typed'],
  };
}

export async function saveDraft(entry: Entry): Promise<void> {
  const wordCount = countWords(blocksToText(entry.blocks));
  await getDB().entries.put({ ...entry, wordCount, updatedAt: new Date().toISOString() });
}

export async function writeRevision(entry: Entry): Promise<void> {
  await getDB().entryRevisions.add({
    id: uid('r'),
    entryId: entry.id,
    at: new Date().toISOString(),
    blocks: entry.blocks.map((b) => ({ ...b })),
    wordCount: countWords(blocksToText(entry.blocks)),
  });
}

export async function saveTelemetry(entry: Entry, t: Telemetry): Promise<void> {
  const snap: TelemetrySnapshot = { ...t, entryId: entry.id, localDay: entry.localDay, computedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION };
  await getDB().telemetry.put(snap);
}

export function normaliseLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Names are not indexed (indexes stay readable when the journal is
// encrypted), so nodes are matched in memory. A journal holds hundreds of
// nodes at most, so this is cheap.
function nodeKey(kind: NodeKind, normalised: string): string {
  return `${kind}\u0000${normalised}`;
}

async function findOrCreateNode(index: Map<string, GraphNode>, kind: NodeKind, label: string, day: string): Promise<GraphNode> {
  const normalised = normaliseLabel(label);
  const existing = index.get(nodeKey(kind, normalised));
  if (existing) return existing;
  const node: GraphNode = { id: uid('n'), kind, label, normalised, firstSeen: day, lastSeen: day, mentionCount: 0 };
  await getDB().nodes.add(node);
  index.set(nodeKey(kind, normalised), node);
  return node;
}

/** Keeps a value node for each core value; creates it if missing, renames it to follow the value. */
export async function syncValueNode(previousLabel: string | null, label: string): Promise<void> {
  const db = getDB();
  const values = await db.nodes.where('kind').equals('value').toArray();
  const wanted = normaliseLabel(label);
  if (values.some((n) => n.normalised === wanted)) return;
  const prev = previousLabel ? values.find((n) => n.normalised === normaliseLabel(previousLabel)) : undefined;
  if (prev) {
    await db.nodes.put({ ...prev, label, normalised: wanted });
    return;
  }
  const day = localDayOf();
  await db.nodes.add({ id: uid('n'), kind: 'value', label, normalised: wanted, firstSeen: day, lastSeen: day, mentionCount: 0 });
}

// Replace this entry's machine-made mentions; keep any the user confirmed.
export async function extractAndStoreMentions(entry: Entry, telemetry: Telemetry, settings?: AppSettings): Promise<void> {
  void settings;
  const db = getDB();
  const [people, values] = await Promise.all([db.nodes.where('kind').equals('person').toArray(), db.coreValues.orderBy('order').toArray()]);
  const entities = extractEntities(
    entry.blocks,
    people.map((p) => p.label),
    values,
    telemetry,
  );

  await db.transaction('rw', db.mentions, db.nodes, async () => {
    const old = await db.mentions.where('entryId').equals(entry.id).toArray();
    const keep = old.filter((m) => m.confirmed);
    await db.mentions.bulkDelete(old.filter((m) => !m.confirmed).map((m) => m.id));
    const index = new Map((await db.nodes.toArray()).map((n) => [nodeKey(n.kind, n.normalised), n]));
    const fresh: Mention[] = [];
    const seenNodes = new Set(keep.map((m) => m.nodeId));
    for (const e of entities) {
      const node = await findOrCreateNode(index, e.kind, e.label, entry.localDay);
      if (seenNodes.has(node.id)) continue;
      seenNodes.add(node.id);
      fresh.push({
        id: uid('m'),
        entryId: entry.id,
        nodeId: node.id,
        blockId: e.blockId,
        start: e.start,
        end: e.end,
        source: e.source,
        confirmed: e.source === 'explicit_tag',
      });
    }
    await db.mentions.bulkAdd(fresh);
  });
}

// Edges and node counts are derived data, rebuilt from mentions at any time.
export async function rebuildGraph(): Promise<void> {
  const db = getDB();
  await db.transaction('rw', [db.mentions, db.nodes, db.edges, db.entries, db.coreValues], async () => {
    const [mentions, nodes, entries, coreValues] = await Promise.all([db.mentions.toArray(), db.nodes.toArray(), db.entries.toArray(), db.coreValues.toArray()]);
    const currentValues = new Set(coreValues.map((v) => normaliseLabel(v.label)));
    const dayOf = new Map(entries.map((e) => [e.id, e.localDay]));
    const byEntry = new Map<string, Set<string>>();
    for (const m of mentions) {
      if (!dayOf.has(m.entryId)) continue;
      if (!byEntry.has(m.entryId)) byEntry.set(m.entryId, new Set());
      byEntry.get(m.entryId)!.add(m.nodeId);
    }
    const counts = new Map<string, { n: number; first: string; last: string }>();
    const edgeMap = new Map<string, { a: string; b: string; w: number; last: string }>();
    for (const [entryId, set] of byEntry) {
      const day = dayOf.get(entryId)!;
      const ids = [...set].sort();
      for (const id of ids) {
        const c = counts.get(id) ?? { n: 0, first: day, last: day };
        c.n++;
        if (day < c.first) c.first = day;
        if (day > c.last) c.last = day;
        counts.set(id, c);
      }
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = `${ids[i]}|${ids[j]}`;
          const e = edgeMap.get(key) ?? { a: ids[i], b: ids[j], w: 0, last: entryId };
          e.w++;
          e.last = entryId;
          edgeMap.set(key, e);
        }
      }
    }
    const updated: GraphNode[] = [];
    const orphanIds: string[] = [];
    for (const n of nodes) {
      const c = counts.get(n.id);
      if (!c) {
        // Unmentioned nodes go, except the node of a current core value.
        if (n.kind === 'value' && currentValues.has(n.normalised)) updated.push({ ...n, mentionCount: 0 });
        else orphanIds.push(n.id);
        continue;
      }
      updated.push({ ...n, mentionCount: c.n, firstSeen: c.first, lastSeen: c.last });
    }
    await db.nodes.bulkDelete(orphanIds);
    await db.nodes.bulkPut(updated);
    await db.edges.clear();
    await db.edges.bulkAdd(
      [...edgeMap.values()].map((e) => ({ id: uid('x'), sourceId: e.a, targetId: e.b, kind: 'co_occurs' as const, weight: e.w, lastEntryId: e.last })),
    );
  });
}

export async function storeAlignment(entryId: string, rows: { valueId: string; score: number; evidence: string }[], source: 'heuristic' | 'llm'): Promise<void> {
  const db = getDB();
  await db.transaction('rw', db.valueAlignments, async () => {
    const old = await db.valueAlignments.where('entryId').equals(entryId).primaryKeys();
    await db.valueAlignments.bulkDelete(old);
    await db.valueAlignments.bulkAdd(rows.map((r) => ({ id: uid('va'), entryId, valueId: r.valueId, score: r.score, evidence: r.evidence, source })));
  });
}

export interface CompletionReport {
  telemetry: Telemetry;
  synthesisProvider: string;
  alignmentSource: 'heuristic' | 'llm';
}

export const COMPLETION_STEPS = ['Saved the entry', 'Scored the writing', 'Linked people, themes and values', 'Distilled the entry'] as const;

export async function completeEntry(entry: Entry, onStep?: (doneIndex: number) => void): Promise<CompletionReport> {
  const db = getDB();
  const settings = await loadSettings();
  const values = await db.coreValues.orderBy('order').toArray();

  // 1. Persist first.
  const finished: Entry = { ...entry, status: 'complete', wordCount: countWords(blocksToText(entry.blocks)), updatedAt: new Date().toISOString() };
  await db.entries.put(finished);
  await writeRevision(finished);
  onStep?.(0);

  // 2. Local jobs.
  const telemetry = computeTelemetry(finished.blocks, settings.thresholds);
  await saveTelemetry(finished, telemetry);
  onStep?.(1);
  await extractAndStoreMentions(finished, telemetry, settings);
  await rebuildGraph();
  await rebuildMemoryArtifacts();
  await storeAlignment(finished.id, heuristicValueAlignment(finished.blocks, values), 'heuristic');
  onStep?.(2);

  // 3. Model jobs, each independent.
  const [synth, llmAlign] = await Promise.allSettled([
    runSynthesis(finished.blocks, telemetry, settings, values),
    runLLMAlignment(finished.blocks, telemetry, settings, values),
  ]);
  let synthesisProvider = 'heuristic';
  if (synth.status === 'fulfilled') {
    synthesisProvider = synth.value.provider;
    await db.syntheses.put({
      entryId: finished.id,
      keyTakeaway: synth.value.keyTakeaway,
      hiddenAssumption: synth.value.hiddenAssumption,
      microAction: synth.value.microAction,
      provider: synth.value.provider,
      model: synth.value.model,
      createdAt: new Date().toISOString(),
    });
  }
  let alignmentSource: 'heuristic' | 'llm' = 'heuristic';
  if (llmAlign.status === 'fulfilled' && llmAlign.value) {
    await storeAlignment(finished.id, llmAlign.value, 'llm');
    alignmentSource = 'llm';
  }
  onStep?.(3);
  return { telemetry, synthesisProvider, alignmentSource };
}

export async function deleteEntry(entryId: string): Promise<void> {
  const db = getDB();
  await db.transaction('rw', [db.entries, db.entryRevisions, db.copilotTurns, db.telemetry, db.syntheses, db.mentions, db.valueAlignments, db.forecasts], async () => {
    await db.entries.delete(entryId);
    await db.entryRevisions.where('entryId').equals(entryId).delete();
    await db.copilotTurns.where('entryId').equals(entryId).delete();
    await db.telemetry.delete(entryId);
    await db.syntheses.delete(entryId);
    await db.mentions.where('entryId').equals(entryId).delete();
    await db.valueAlignments.where('entryId').equals(entryId).delete();
    const fs = await db.forecasts.where('entryId').equals(entryId).toArray();
    await db.forecasts.bulkPut(fs.map((f) => ({ ...f, entryId: null })));
  });
  await rebuildGraph();
  await rebuildMemoryArtifacts();
}

export function blocksFromPlain(paragraphs: string[]): Block[] {
  return paragraphs.map((text) => ({ id: uid('b'), text }));
}
