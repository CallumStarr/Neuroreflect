// Core data model for NeuroReflect. Mirrors ARCHITECTURE_SPEC.md v0.2 Section 6,
// with entries stored as blocks so anchors survive edits (spec Section 2.5).

export type ISODate = string; // full ISO timestamp
export type LocalDay = string; // YYYY-MM-DD in the user's local time

export interface Block {
  id: string;
  text: string;
}

export type InputSource = 'typed' | 'dictated';

export interface Entry {
  id: string;
  title: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  localDay: LocalDay;
  status: 'draft' | 'complete';
  blocks: Block[];
  wordCount: number;
  activeSeconds: number;
  inputSources: InputSource[];
}

export interface EntryRevision {
  id: string;
  entryId: string;
  at: ISODate;
  blocks: Block[];
  wordCount: number;
}

export type CopilotMode = 'socratic' | 'lens' | 'synthesis' | 'distancing';
export type LensId = 'stoic' | 'first_principles' | 'cbt' | 'act';
export type ProviderId = 'heuristic' | 'ollama' | 'anthropic' | 'openai';

export interface Anchor {
  blockId: string;
  offset: number;
}

export interface CopilotTurn {
  id: string;
  entryId: string;
  pairId: string;
  mode: CopilotMode;
  lens: LensId | null;
  role: 'assistant' | 'user';
  text: string;
  anchor: Anchor | null;
  provider: ProviderId;
  model: string;
  fallbackUsed: boolean;
  incomplete: boolean;
  createdAt: ISODate;
}

export interface Telemetry {
  wordCount: number;
  iTalkDensity: number;
  negAffectDensity: number;
  posAffectDensity: number;
  cogProcDensity: number;
  fusionScore: number; // 0-100, 100 = fully defused
  fusedCount: number;
  defusedCount: number;
  avoidanceDensity: number;
  avoidanceHits: string[];
  granularityIndex: number; // distinct fine emotion concepts per 1000 words
  fineLabels: string[];
  coarseLabels: string[];
  ruminationFlag: boolean;
}

export interface TelemetrySnapshot extends Telemetry {
  entryId: string;
  localDay: LocalDay;
  computedAt: ISODate;
  engineVersion: string;
}

export interface Synthesis {
  entryId: string;
  keyTakeaway: string;
  hiddenAssumption: string;
  microAction: string;
  provider: ProviderId;
  model: string;
  createdAt: ISODate;
}

export type NodeKind = 'person' | 'theme' | 'value' | 'distortion' | 'pattern';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  normalised: string;
  firstSeen: LocalDay;
  lastSeen: LocalDay;
  mentionCount: number;
}

export type MentionSource = 'explicit_tag' | 'heuristic' | 'llm';

export interface Mention {
  id: string;
  entryId: string;
  nodeId: string;
  blockId: string | null;
  start: number;
  end: number;
  source: MentionSource;
  confirmed: boolean;
}

export interface Edge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: 'co_occurs';
  weight: number;
  lastEntryId: string;
}

export interface Forecast {
  id: string;
  entryId: string | null;
  eventName: string;
  targetDate: LocalDay;
  predictedDread: number; // 0-100
  predictedCoping: number; // 0-100
  worstCase: string;
  actualImpact: number | null; // 0-100
  actualCoping: number | null;
  actualNote: string;
  calibratedAt: ISODate | null;
  createdAt: ISODate;
}

export interface CoreValue {
  id: string;
  label: string;
  description: string;
  order: number;
}

export interface ValueAlignment {
  id: string;
  entryId: string;
  valueId: string;
  score: number; // -2 drift to +2 aligned, 0 = not mentioned / neutral
  evidence: string;
  source: 'heuristic' | 'llm';
}

export interface PromptTemplate {
  id: string;
  title: string;
  description: string;
  /** Mode-specific instructions. The shared safety and style rules are always prepended. */
  body: string;
  /** Output the app parses (synthesis and alignment); shown as a caution when editing. */
  structured?: boolean;
  /** A specific caution shown when editing, when the app relies on part of the reply. */
  caution?: string;
}

/** A user's edited version of a built-in template, stored in IndexedDB. */
export interface PromptOverride {
  id: string;
  body: string;
  updatedAt: ISODate;
}

export interface ProviderSettings {
  primary: ProviderId;
  ollamaUrl: string;
  ollamaModel: string;
  anthropicKey: string;
  anthropicModel: string;
  openaiKey: string;
  openaiModel: string;
}

export interface RuminationThresholds {
  minWords: number;
  iTalk: number;
  negAffect: number;
  cogProcMax: number;
}

export interface AppSettings {
  userName: string;
  provider: ProviderSettings;
  thresholds: RuminationThresholds;
  seeded: boolean;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

// ---------- long-term memory (derived from entries, rebuilt on demand) ----------

/** One searchable passage of a completed entry. The text itself stays in the entry. */
export interface MemoryChunk {
  id: string;
  entryId: string;
  localDay: LocalDay;
  blockId: string;
  start: number;
  end: number;
  /** Quantised embedding, base64 of Int8 values. */
  vec: string;
  model: string;
}

export type MomentType = 'event' | 'worry' | 'emotion' | 'insight' | 'decision' | 'relationship';

/** A significant passage inside an entry, with its own embedding. */
export interface Moment {
  id: string;
  entryId: string;
  localDay: LocalDay;
  blockId: string;
  start: number;
  end: number;
  type: MomentType;
  title: string;
  text: string;
  /** 1 (minor) to 5 (defining). */
  importance: number;
  nodeIds: string[];
  vec: string;
}

export type ThreadTrend = 'easing' | 'building' | 'steady';

/** A storyline: moments across several days that keep returning to the same thing. */
export interface Thread {
  id: string;
  title: string;
  momentIds: string[];
  entryIds: string[];
  nodeIds: string[];
  firstDay: LocalDay;
  lastDay: LocalDay;
  status: 'active' | 'quiet';
  trend: ThreadTrend;
  summary: string;
  /**
   * Negative-affect density of the passages about this thread: the mean over
   * the earlier entries, and the most recent entry on its own.
   */
  negEarly: number;
  negLate: number;
}

export type ChapterKind = 'month' | 'week';

export interface Chapter {
  id: string;
  kind: ChapterKind;
  /** YYYY-MM for a month, YYYY-Www for a week. */
  key: string;
  from: LocalDay;
  to: LocalDay;
  title: string;
  narrative: string;
  shifts: string[];
  carryForward: string;
  themes: { label: string; count: number }[];
  people: { label: string; count: number }[];
  stats: {
    entries: number;
    words: number;
    avgDefusion: number;
    avgGranularity: number;
    avgINeg: number;
    ruminationEntries: number;
    forecastErrorMean: number | null;
  };
  entryIds: string[];
  provider: ProviderId;
  model: string;
  /** Hash of the entry set the chapter was written from; differs when entries change. */
  basis: string;
  createdAt: ISODate;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Citation {
  n: number;
  entryId: string;
  localDay: LocalDay;
  blockId: string | null;
  snippet: string;
  title: string;
}

export interface ToolStep {
  tool: string;
  args: Record<string, unknown>;
  resultSummary: string;
  /** Passages that were placed in a prompt for a cloud provider; empty when everything stayed on this device. */
  sentToProvider: number;
  ms: number;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: 'user' | 'assistant';
  text: string;
  citations: Citation[];
  steps: ToolStep[];
  provider: ProviderId | null;
  model: string;
  fallbackUsed: boolean;
  incomplete: boolean;
  createdAt: ISODate;
}
