// Assembles stateless co-pilot requests client-side (spec Section 8.2) and runs
// them through the configured provider with the heuristic engine as fallback.

import { getDB } from './db';
import { modelFor, streamFrom, streamText, type ChatMessage } from './ai-provider';
import { heuristicDistancing, heuristicLens, heuristicSocratic, heuristicSynthesis } from './heuristic-copilot';
import { composeSystem, getTemplate, lensTemplateId } from './prompts';
import { systemPromptFor } from './templates';
import type { AppSettings, Block, CopilotMode, CopilotTurn, CoreValue, LensId, ProviderId, Telemetry } from './types';
import { addDays, blocksToText, localDayOf, uid } from './util';

export interface MemoryBrief {
  recurringThemes: { label: string; count: number; lastSeen: string }[];
  people: { label: string; count: number }[];
  coreValues: string[];
  openForecasts: { eventName: string; targetDate: string }[];
}

export async function buildMemoryBrief(): Promise<MemoryBrief> {
  const db = getDB();
  const since = addDays(localDayOf(), -14);
  const [themes, people, values, forecasts] = await Promise.all([
    db.nodes.where('kind').equals('theme').toArray(),
    db.nodes.where('kind').equals('person').toArray(),
    db.coreValues.orderBy('order').toArray(),
    db.forecasts.toArray(),
  ]);
  return {
    recurringThemes: themes
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, 5)
      .map((t) => ({ label: t.label, count: t.mentionCount, lastSeen: t.lastSeen })),
    people: people
      .filter((p) => p.lastSeen >= since)
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, 5)
      .map((p) => ({ label: p.label, count: p.mentionCount })),
    coreValues: values.map((v) => v.label),
    openForecasts: forecasts.filter((f) => f.calibratedAt === null).map((f) => ({ eventName: f.eventName, targetDate: f.targetDate })),
  };
}

function trimToWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return `[...earlier text omitted...] ${words.slice(-maxWords).join(' ')}`;
}

function telemetryLine(t: Telemetry): string {
  return [
    `words=${t.wordCount}`,
    `i_talk=${(t.iTalkDensity * 100).toFixed(1)}%`,
    `negative_affect=${(t.negAffectDensity * 100).toFixed(1)}%`,
    `cognitive_processing=${(t.cogProcDensity * 100).toFixed(1)}%`,
    `defusion_score=${t.fusionScore}/100`,
    `granularity_index=${t.granularityIndex.toFixed(1)}`,
    `rumination_flag=${t.ruminationFlag}`,
    t.coarseLabels.length ? `coarse_labels=${t.coarseLabels.join(',')}` : '',
    t.avoidanceHits.length ? `avoidance_cues=${t.avoidanceHits.join(',')}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function buildMessages(args: {
  templateId: string;
  /** Resolved system prompt (with any user edits); defaults to the built-in template. */
  system?: string;
  blocks: Block[];
  turns: CopilotTurn[];
  telemetry: Telemetry;
  brief: MemoryBrief;
  userName: string;
  localDate: string;
  extra?: string;
}): ChatMessage[] {
  const { templateId, system, blocks, turns, telemetry, brief, userName, localDate, extra } = args;
  const context = [
    `Date: ${localDate}`,
    userName ? `Person's name: ${userName}` : '',
    `Measured telemetry for this entry: ${telemetryLine(telemetry)}`,
    brief.coreValues.length ? `Their stated core values: ${brief.coreValues.join(', ')}` : '',
    brief.recurringThemes.length ? `Recurring themes in their journal: ${brief.recurringThemes.map((t) => `${t.label} (${t.count})`).join(', ')}` : '',
    brief.people.length ? `People mentioned recently: ${brief.people.map((p) => p.label).join(', ')}` : '',
    brief.openForecasts.length ? `Upcoming events they have forecast: ${brief.openForecasts.map((f) => `${f.eventName} on ${f.targetDate}`).join('; ')}` : '',
    extra ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  const previous = turns
    .filter((t) => t.role === 'assistant' && !t.incomplete)
    .map((t) => `- ${t.text}`)
    .join('\n');

  return [
    { role: 'system', content: system ?? composeSystem(getTemplate(templateId).body) },
    {
      role: 'user',
      content: `${context}\n\n${previous ? `Questions or prompts already given in this entry:\n${previous}\n\n` : ''}Journal entry so far:\n"""\n${trimToWords(blocksToText(blocks), 1500)}\n"""`,
    },
  ];
}

// "One question per Socratic turn": keep only the first question sentence.
export function enforceSingleQuestion(text: string): string {
  const cleaned = text.trim().replace(/^["']|["']$/g, '');
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  const firstQ = sentences.find((s) => s.trim().endsWith('?'));
  return (firstQ ?? cleaned).trim();
}

export interface RunArgs {
  entryId: string;
  mode: CopilotMode;
  lens: LensId | null;
  blocks: Block[];
  anchorBlockId: string | null;
  telemetry: Telemetry;
  settings: AppSettings;
  signal: AbortSignal;
  onToken: (fullTextSoFar: string) => void;
}

const FIRST_TOKEN_TIMEOUT_MS = 20000;

export async function runCopilot(args: RunArgs): Promise<CopilotTurn> {
  const { entryId, mode, lens, blocks, telemetry, settings, signal, onToken, anchorBlockId } = args;
  const db = getDB();
  const templateId = mode === 'lens' && lens ? lensTemplateId(lens) : mode === 'distancing' ? 'distancing' : 'socratic';
  const [turns, values, brief, system] = await Promise.all([
    db.copilotTurns.where('entryId').equals(entryId).sortBy('createdAt'),
    db.coreValues.orderBy('order').toArray(),
    buildMemoryBrief(),
    systemPromptFor(templateId),
  ]);
  const askedBefore = turns.filter((t) => t.role === 'assistant').map((t) => t.text);

  const messages = buildMessages({
    templateId,
    system,
    blocks,
    turns,
    telemetry,
    brief,
    userName: settings.userName,
    localDate: localDayOf(),
  });

  const heuristicText = () => {
    if (mode === 'lens' && lens) return heuristicLens(lens, blocks, telemetry, values);
    if (mode === 'distancing') return heuristicDistancing(blocks, settings.userName, askedBefore.length);
    return heuristicSocratic(blocks, telemetry, askedBefore);
  };

  let provider: ProviderId = settings.provider.primary;
  let fallbackUsed = false;
  let text = '';
  let incomplete = false;

  const consume = async (stream: AsyncGenerator<string>) => {
    for await (const piece of stream) {
      text += piece;
      onToken(mode === 'socratic' ? text : text);
    }
  };

  if (provider !== 'heuristic') {
    const local = new AbortController();
    const onAbort = () => local.abort();
    signal.addEventListener('abort', onAbort);
    let gotToken = false;
    const timer = setTimeout(() => {
      if (!gotToken) local.abort();
    }, FIRST_TOKEN_TIMEOUT_MS);
    try {
      const stream = streamFrom(provider, settings.provider, messages, local.signal, mode === 'lens' ? 500 : 160);
      for await (const piece of stream) {
        gotToken = true;
        text += piece;
        onToken(text);
      }
      if (!text.trim()) throw new Error('empty response');
    } catch (err) {
      if (signal.aborted) {
        incomplete = true;
      } else {
        console.warn('[NeuroReflect] provider failed, using heuristic fallback:', err instanceof Error ? err.message : err);
        provider = 'heuristic';
        fallbackUsed = true;
        text = '';
      }
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }

  if (provider === 'heuristic' && !incomplete) {
    await consume(streamText(heuristicText(), signal));
    if (signal.aborted) incomplete = true;
  }

  if (!incomplete && (mode === 'socratic' || mode === 'distancing') && provider !== 'heuristic') {
    text = mode === 'socratic' ? enforceSingleQuestion(text) : text.trim();
    onToken(text);
  }

  const turn: CopilotTurn = {
    id: uid('t'),
    entryId,
    pairId: uid('p'),
    mode,
    lens,
    role: 'assistant',
    text: text.trim(),
    anchor: anchorBlockId ? { blockId: anchorBlockId, offset: blocks.find((b) => b.id === anchorBlockId)?.text.length ?? 0 } : null,
    provider,
    model: modelFor(settings.provider, provider),
    fallbackUsed,
    incomplete,
    createdAt: new Date().toISOString(),
  };
  if (turn.text) await db.copilotTurns.add(turn);
  return turn;
}

// ---------- structured jobs (synthesis, alignment) ----------

function extractJSON(text: string): unknown {
  const start = text.search(/[[{]/);
  if (start < 0) throw new Error('no JSON found');
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);
  return JSON.parse(text.slice(start, end + 1));
}

export async function completeJSON(settings: AppSettings, messages: ChatMessage[], signal: AbortSignal): Promise<unknown> {
  const id = settings.provider.primary;
  if (id === 'heuristic') throw new Error('heuristic provider has no structured mode');
  let out = '';
  for await (const piece of streamFrom(id, settings.provider, messages, signal, 600)) out += piece;
  return extractJSON(out);
}

export interface SynthesisResult {
  keyTakeaway: string;
  hiddenAssumption: string;
  microAction: string;
  provider: ProviderId;
  model: string;
}

export async function runSynthesis(blocks: Block[], telemetry: Telemetry, settings: AppSettings, values: CoreValue[]): Promise<SynthesisResult> {
  if (settings.provider.primary !== 'heuristic') {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const [brief, system] = await Promise.all([buildMemoryBrief(), systemPromptFor('synthesis')]);
      const messages = buildMessages({ templateId: 'synthesis', system, blocks, turns: [], telemetry, brief, userName: settings.userName, localDate: localDayOf() });
      const json = (await completeJSON(settings, messages, ctrl.signal)) as Record<string, unknown>;
      if (typeof json.keyTakeaway === 'string' && typeof json.hiddenAssumption === 'string' && typeof json.microAction === 'string') {
        return {
          keyTakeaway: json.keyTakeaway,
          hiddenAssumption: json.hiddenAssumption,
          microAction: json.microAction,
          provider: settings.provider.primary,
          model: modelFor(settings.provider, settings.provider.primary),
        };
      }
    } catch (err) {
      console.warn('[NeuroReflect] synthesis fell back to heuristic:', err instanceof Error ? err.message : err);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ...heuristicSynthesis(blocks, telemetry, values), provider: 'heuristic', model: 'heuristic-v1' };
}

export async function runLLMAlignment(blocks: Block[], telemetry: Telemetry, settings: AppSettings, values: CoreValue[]): Promise<{ valueId: string; score: number; evidence: string }[] | null> {
  if (settings.provider.primary === 'heuristic' || values.length === 0) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const [brief, system] = await Promise.all([buildMemoryBrief(), systemPromptFor('alignment')]);
    const messages = buildMessages({ templateId: 'alignment', system, blocks, turns: [], telemetry, brief, userName: settings.userName, localDate: localDayOf() });
    const json = await completeJSON(settings, messages, ctrl.signal);
    if (!Array.isArray(json)) return null;
    const out: { valueId: string; score: number; evidence: string }[] = [];
    for (const row of json as { value?: string; score?: number; evidence?: string }[]) {
      const v = values.find((x) => x.label.toLowerCase() === String(row.value ?? '').toLowerCase());
      if (!v || typeof row.score !== 'number') continue;
      out.push({ valueId: v.id, score: Math.max(-2, Math.min(2, Math.round(row.score))), evidence: String(row.evidence ?? '').slice(0, 220) });
    }
    return out.length ? out : null;
  } catch (err) {
    console.warn('[NeuroReflect] alignment fell back to heuristic:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
