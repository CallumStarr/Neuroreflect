import Dexie, { type EntityTable } from 'dexie';
import { lockMiddleware } from './lock-core';
import type {
  AppSettings,
  Chapter,
  Chat,
  ChatMessage,
  CopilotTurn,
  MemoryChunk,
  Moment,
  Thread,
  CoreValue,
  Edge,
  Entry,
  EntryRevision,
  Forecast,
  GraphNode,
  Mention,
  PromptOverride,
  SettingRow,
  Synthesis,
  TelemetrySnapshot,
  ValueAlignment,
} from './types';

export const DB_NAME = 'neuroreflect';

// Version 1 as first shipped.
export const SCHEMA_V1 = {
  entries: 'id, localDay, status, updatedAt',
  entryRevisions: 'id, entryId, at',
  copilotTurns: 'id, entryId, [entryId+createdAt]',
  telemetry: 'entryId, localDay, computedAt',
  syntheses: 'entryId',
  nodes: 'id, kind, normalised, [kind+normalised], lastSeen',
  mentions: 'id, entryId, nodeId',
  edges: 'id, sourceId, targetId',
  forecasts: 'id, entryId, targetDate, calibratedAt',
  coreValues: 'id, order',
  valueAlignments: 'id, entryId, valueId',
  settings: 'key',
  promptTemplates: 'id',
};

// Version 2: no index may hold personal text, because indexed fields stay
// readable when the passphrase lock is on. Node names were indexed in v1.
export const SCHEMA_V2 = { ...SCHEMA_V1, nodes: 'id, kind, lastSeen' };

// Version 3: long-term memory (search index, moments, threads, chapters) and
// journal chat. Only ids, dates and keys are indexed; text stays unindexed.
export const SCHEMA = {
  ...SCHEMA_V2,
  memoryChunks: 'id, entryId, localDay',
  moments: 'id, entryId, localDay',
  threads: 'id, lastDay',
  chapters: 'id, kind, key',
  chats: 'id, updatedAt',
  chatMessages: 'id, chatId, [chatId+createdAt]',
};
export const SCHEMA_VERSION = 3;

// Everything lives in the user's browser (IndexedDB). No server ever sees an entry.
export class NeuroReflectDB extends Dexie {
  entries!: EntityTable<Entry, 'id'>;
  entryRevisions!: EntityTable<EntryRevision, 'id'>;
  copilotTurns!: EntityTable<CopilotTurn, 'id'>;
  telemetry!: EntityTable<TelemetrySnapshot, 'entryId'>;
  syntheses!: EntityTable<Synthesis, 'entryId'>;
  nodes!: EntityTable<GraphNode, 'id'>;
  mentions!: EntityTable<Mention, 'id'>;
  edges!: EntityTable<Edge, 'id'>;
  forecasts!: EntityTable<Forecast, 'id'>;
  coreValues!: EntityTable<CoreValue, 'id'>;
  valueAlignments!: EntityTable<ValueAlignment, 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;
  promptTemplates!: EntityTable<PromptOverride, 'id'>;
  memoryChunks!: EntityTable<MemoryChunk, 'id'>;
  moments!: EntityTable<Moment, 'id'>;
  threads!: EntityTable<Thread, 'id'>;
  chapters!: EntityTable<Chapter, 'id'>;
  chats!: EntityTable<Chat, 'id'>;
  chatMessages!: EntityTable<ChatMessage, 'id'>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores(SCHEMA_V1);
    this.version(2)
      .stores({ nodes: SCHEMA.nodes })
      // v1 mirrored the built-in prompt templates here on every boot; the table
      // now holds only the user's edits.
      .upgrade((tx) => tx.table('promptTemplates').clear());
    this.version(3).stores({
      memoryChunks: SCHEMA.memoryChunks,
      moments: SCHEMA.moments,
      threads: SCHEMA.threads,
      chapters: SCHEMA.chapters,
      chats: SCHEMA.chats,
      chatMessages: SCHEMA.chatMessages,
    });
    this.use(lockMiddleware);
  }
}

let instance: NeuroReflectDB | null = null;

// Lazily created so nothing touches IndexedDB during static prerendering.
export function getDB(): NeuroReflectDB {
  if (!instance) instance = new NeuroReflectDB();
  return instance;
}

export const DEFAULT_SETTINGS: AppSettings = {
  userName: '',
  provider: {
    primary: 'heuristic',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.1',
    anthropicKey: '',
    anthropicModel: 'claude-sonnet-5-5',
    openaiKey: '',
    // OpenAI's suggested replacement for gpt-4o-mini, which shuts down on 14 January 2027.
    openaiModel: 'gpt-6-luna',
  },
  thresholds: { minWords: 100, iTalk: 0.1, negAffect: 0.03, cogProcMax: 0.025 },
  seeded: false,
};

export async function loadSettings(): Promise<AppSettings> {
  const row = await getDB().settings.get('app');
  const stored = (row?.value ?? {}) as Partial<AppSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    provider: { ...DEFAULT_SETTINGS.provider, ...(stored.provider ?? {}) },
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(stored.thresholds ?? {}) },
  };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings();
  const next: AppSettings = {
    ...current,
    ...patch,
    provider: { ...current.provider, ...(patch.provider ?? {}) },
    thresholds: { ...current.thresholds, ...(patch.thresholds ?? {}) },
  };
  await getDB().settings.put({ key: 'app', value: next });
  return next;
}

export const TABLE_NAMES = [
  'entries',
  'entryRevisions',
  'copilotTurns',
  'telemetry',
  'syntheses',
  'nodes',
  'mentions',
  'edges',
  'forecasts',
  'coreValues',
  'valueAlignments',
  'settings',
  'promptTemplates',
  'memoryChunks',
  'moments',
  'threads',
  'chapters',
  'chats',
  'chatMessages',
] as const;
export type TableName = (typeof TABLE_NAMES)[number];

/** Rebuilt from entries at any time, so exports leave them out. Chapters are
 * included: every rebuild writes them afresh from the entries. */
export const DERIVED_TABLES: readonly TableName[] = ['memoryChunks', 'moments', 'threads', 'chapters'];
