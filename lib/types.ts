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
  /** The starter prompt shown with this entry, if any. */
  prompt?: EntryPrompt | null;
  /** One exercise per entry, so the journal can tell which one helped. */
  exercise?: EntryExercise | null;
  /** One-tap suggestions the person dismissed, by paragraph and sentence. */
  dismissedSuggestions?: string[];
}

export interface EntryRevision {
  id: string;
  entryId: string;
  at: ISODate;
  blocks: Block[];
  wordCount: number;
}

/**
 * socratic: one question that goes deeper. distancing and concrete: what the
 * rumination guard offers instead while the writing circles. exercise: a step
 * of a technique, written into the entry like a question.
 */
export type CopilotMode = 'socratic' | 'lens' | 'synthesis' | 'distancing' | 'concrete' | 'exercise';
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
  /** For exercise steps: which technique, and which step of it. */
  technique?: TechniqueId;
  step?: number;
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
  guidance: GuidanceSettings;
  planner: PlannerSettings;
  /** Content migrations already applied after unlock (lib/migrations.ts). */
  migrations: string[];
  /** Last time the journal was open, for reminders missed while it was closed. */
  lastOpenAt: ISODate | null;
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

// ---------- guidance: how much the journal says, and what it is for ----------

/** Blank page says nothing; Open offers one open prompt; Guided picks a specific one; Deep adds techniques. */
export type GuidanceLevel = 'blank' | 'open' | 'guided' | 'deep';

export type GoalId = 'understand' | 'calmer' | 'goals' | 'relationships' | 'sleep' | 'good_things' | 'decisions' | 'story';

export type TechniqueId =
  | 'if_then_feelings'
  | 'cool_down'
  | 'savouring'
  | 'self_compassion'
  | 'emotion_naming'
  | 'worry_period'
  | 'concrete_step'
  | 'kindness'
  | 'forgiveness'
  | 'three_good_things'
  | 'values_first'
  | 'expressive'
  | 'next_chapter'
  | 'strengths'
  | 'your_story';

export type Tone = 'gentle' | 'plain' | 'curious';

export interface GuidanceSettings {
  level: GuidanceLevel;
  goals: GoalId[];
  tone: Tone;
  /** Topics the person asked the journal to leave alone, in their own words. */
  avoidTopics: string[];
  /** Tick boxes. A technique missing here follows its default for the level. */
  techniques: Partial<Record<TechniqueId, boolean>>;
  setupDone: boolean;
  /** Offer the one-tap feeling check before and after an exercise. */
  feelingCheck: boolean;
}

/** Where the person is in a technique, stored on the entry it was written in. */
export interface EntryExercise {
  technique: TechniqueId;
  step: number;
  startedAt: ISODate;
  finishedAt: ISODate | null;
  /** Set when the person chose "This is too much" and switched to something lighter. */
  exitedAt: ISODate | null;
  /** Expressive writing and programmes count sessions across entries. */
  session: number;
  /** The lighter technique chosen from "This is too much", if any. */
  switchedTo?: TechniqueId | null;
  /** Set on the lighter exercise that replaced the one the person stopped. */
  switchedFrom?: TechniqueId | null;
  /** Paused by the rumination guard. */
  pausedAt?: ISODate | null;
}

/** The prompt shown at the top of an entry, with the reason it was chosen. */
export interface EntryPrompt {
  id: string;
  text: string;
  reason: string;
  level: GuidanceLevel;
}

export type FeelingValue = 1 | 2 | 3 | 4 | 5;

/** A one-tap, plain-word feeling check. Never a score of any condition. */
export interface FeelingCheck {
  id: string;
  entryId: string | null;
  technique: TechniqueId | null;
  phase: 'before' | 'after' | 'next';
  value: FeelingValue;
  at: ISODate;
  localDay: LocalDay;
}

// ---------- planner ----------

/** Minutes before the start; 0 means at the start; null means no reminder. */
export type ReminderMinutes = number | null;

export interface Repeat {
  /** RFC 5545 RRULE body without DTSTART, e.g. FREQ=WEEKLY;BYDAY=MO. */
  rule: string;
  /** Tasks only: the next one is counted from the day it was done ("every!" in some apps). */
  fromCompletion: boolean;
}

/** An if-then plan: when and where turn a task into "When X at Y, I will Z". */
export interface IfThen {
  when: string;
  where: string;
}

export interface PlanEvent {
  id: string;
  title: string;
  notes: string;
  location: string;
  startDay: LocalDay;
  /** HH:mm, or null for an all-day event. */
  startTime: string | null;
  endDay: LocalDay;
  endTime: string | null;
  repeat: Repeat | null;
  /** Start days of occurrences that were deleted from a repeating event. */
  exdates: LocalDay[];
  reminderMinutes: ReminderMinutes;
  /** "This one matters to me": a worry dump and plan before, and "How did it go?" after. */
  big: boolean;
  /** Plan one thing that matters: the core value this is for. */
  valueId: string | null;
  forecastId: string | null;
  plan: IfThen | null;
  entryId: string | null;
  source: 'manual' | 'entry' | 'ics' | 'sample';
  icsUid: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type TaskStatus = 'open' | 'done' | 'let_go';

export interface Task {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  /** The day it is planned for; null means Later, with no date. */
  dueDay: LocalDay | null;
  dueTime: string | null;
  repeat: Repeat | null;
  plan: IfThen | null;
  reminderMinutes: ReminderMinutes;
  valueId: string | null;
  /** The entry it came from, and the paragraph, so it always links back. */
  entryId: string | null;
  blockId: string | null;
  sourceText: string;
  order: number;
  createdAt: ISODate;
  updatedAt: ISODate;
  doneAt: ISODate | null;
  /** Last time the person chose Keep for a task that had waited a while. */
  reviewedAt: ISODate | null;
  letGoNote: string;
  /** For a done copy of a repeating task: the task it repeats. */
  repeatOf: string | null;
  /** Where a task came from when it was part of an exercise or flow. */
  tag?: TaskTag | null;
}

export type TaskTag = 'kindness' | 'tomorrow_list' | 'exercise' | 'worry' | 'ai';

/** A reminder that has already been shown, so it is never shown twice. */
export interface ReminderLog {
  id: string;
  firedAt: ISODate;
}

/** A one-line quick capture, or a worry waiting for the worry period. */
export interface CaptureNote {
  id: string;
  kind: 'note' | 'worry';
  text: string;
  createdAt: ISODate;
  doneAt: ISODate | null;
  entryId: string | null;
}

export interface PlannerSettings {
  /** Desktop: closing the window keeps NeuroReflect in the system tray so reminders still arrive. */
  keepInTray: boolean;
  startAtLogin: boolean;
  /** Reminder for new events, minutes before. */
  defaultReminder: ReminderMinutes;
  weekStartsOn: 0 | 1;
  /** Desktop: Ctrl+Alt+Space opens quick capture from anywhere. */
  globalCapture: boolean;
  worryPeriod: { enabled: boolean; time: string; place: string; minutes: number };
  /** Evening prompt to write tomorrow's list, offered when better sleep is a goal. */
  bedtimeList: { enabled: boolean; after: string };
  /** 0 = Sunday. */
  weeklyReviewDay: number;
  /** One-tap: offer "Add to your to-do list?" for lines that read like a task. */
  oneTap: boolean;
  /** Let the configured AI provider suggest tasks when an entry is finished. Off by default. */
  aiTaskSuggestions: boolean;
  /** Show reminder text while the journal is locked. Off: a locked journal shows only "You have a reminder". */
  reminderTextWhenLocked: boolean;
}
