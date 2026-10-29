import Dexie, { type EntityTable } from 'dexie';
import { lockMiddleware } from './lock-core';
import type {
  AppSettings,
  CaptureNote,
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
  FeelingCheck,
  Forecast,
  GraphNode,
  Mention,
  PlanEvent,
  PromptOverride,
  ReminderLog,
  SettingRow,
  Synthesis,
  Task,
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
export const SCHEMA_V3 = {
  ...SCHEMA_V2,
  memoryChunks: 'id, entryId, localDay',
  moments: 'id, entryId, localDay',
  threads: 'id, lastDay',
  chapters: 'id, kind, key',
  chats: 'id, updatedAt',
  chatMessages: 'id, chatId, [chatId+createdAt]',
};

// Version 4: the planner (events, tasks, quick notes), shown reminders and
// feeling checks. Indexed fields are ids, days and a task's status, which stay
// readable when the lock is on, like entry dates. Titles, times and repeats are
// sealed with the rest of the record.
export const SCHEMA = {
  ...SCHEMA_V3,
  events: 'id, startDay, updatedAt',
  tasks: 'id, status, dueDay, entryId, updatedAt',
  notes: 'id, createdAt',
  reminderLog: 'id, firedAt',
  feelingChecks: 'id, entryId, localDay',
};
export const SCHEMA_VERSION = 4;

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
  events!: EntityTable<PlanEvent, 'id'>;
  tasks!: EntityTable<Task, 'id'>;
  notes!: EntityTable<CaptureNote, 'id'>;
  reminderLog!: EntityTable<ReminderLog, 'id'>;
  feelingChecks!: EntityTable<FeelingCheck, 'id'>;

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
    this.version(4).stores({
      events: SCHEMA.events,
      tasks: SCHEMA.tasks,
      notes: SCHEMA.notes,
      reminderLog: SCHEMA.reminderLog,
      feelingChecks: SCHEMA.feelingChecks,
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
  guidance: {
    level: 'guided',
    goals: [],
    tone: 'gentle',
    avoidTopics: [],
    techniques: {},
    setupDone: false,
    feelingCheck: true,
  },
  planner: {
    keepInTray: true,
    startAtLogin: false,
    defaultReminder: 15,
    weekStartsOn: 1,
    globalCapture: false,
    worryPeriod: { enabled: false, time: '18:00', place: 'at the kitchen table', minutes: 30 },
    bedtimeList: { enabled: true, after: '20:30' },
    weeklyReviewDay: 0,
    oneTap: true,
    aiTaskSuggestions: false,
    reminderTextWhenLocked: false,
  },
  migrations: [],
  lastOpenAt: null,
};

type PlannerPatch = Partial<Omit<AppSettings['planner'], 'worryPeriod' | 'bedtimeList'>> & {
  worryPeriod?: Partial<AppSettings['planner']['worryPeriod']>;
  bedtimeList?: Partial<AppSettings['planner']['bedtimeList']>;
};

export type SettingsPatch = Omit<Partial<AppSettings>, 'provider' | 'thresholds' | 'guidance' | 'planner'> & {
  provider?: Partial<AppSettings['provider']>;
  thresholds?: Partial<AppSettings['thresholds']>;
  guidance?: Partial<AppSettings['guidance']>;
  planner?: PlannerPatch;
};

function mergeSettings(base: AppSettings, patch: SettingsPatch): AppSettings {
  const planner: AppSettings['planner'] = {
    ...base.planner,
    ...(patch.planner ?? {}),
    worryPeriod: { ...base.planner.worryPeriod, ...(patch.planner?.worryPeriod ?? {}) },
    bedtimeList: { ...base.planner.bedtimeList, ...(patch.planner?.bedtimeList ?? {}) },
  };
  return {
    ...base,
    ...patch,
    provider: { ...base.provider, ...(patch.provider ?? {}) },
    thresholds: { ...base.thresholds, ...(patch.thresholds ?? {}) },
    guidance: { ...base.guidance, ...(patch.guidance ?? {}), techniques: { ...base.guidance.techniques, ...(patch.guidance?.techniques ?? {}) } },
    planner,
    migrations: patch.migrations ?? base.migrations,
  };
}

export async function loadSettings(): Promise<AppSettings> {
  const row = await getDB().settings.get('app');
  const stored = (row?.value ?? {}) as SettingsPatch;
  return mergeSettings(DEFAULT_SETTINGS, stored);
}

export async function saveSettings(patch: SettingsPatch): Promise<AppSettings> {
  const current = await loadSettings();
  const next = mergeSettings(current, patch);
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
  'events',
  'tasks',
  'notes',
  'reminderLog',
  'feelingChecks',
] as const;
export type TableName = (typeof TABLE_NAMES)[number];

/** Rebuilt from entries at any time, so exports leave them out. Chapters are
 * included: every rebuild writes them afresh from the entries. */
export const DERIVED_TABLES: readonly TableName[] = ['memoryChunks', 'moments', 'threads', 'chapters'];

/** About this device only (which reminders it has shown), so never exported or merged. */
export const DEVICE_TABLES: readonly TableName[] = ['reminderLog'];
