// Unified AI layer. Cloud calls go straight from this device to the provider with
// the user's own key; nothing passes through a NeuroReflect server. The heuristic
// provider needs no network at all and is always the last fallback.

import { isDesktop, isThisComputer, providerFetch } from './platform';
import type { ProviderId, ProviderSettings } from './types';
import { sleep } from './util';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamResult {
  provider: ProviderId;
  model: string;
  fallbackUsed: boolean;
}

export class ProviderError extends Error {
  constructor(public provider: ProviderId, message: string) {
    super(`${provider}: ${message}`);
  }
}

async function* readSSE(res: Response, signal: AbortSignal): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    if (signal.aborted) {
      reader.cancel().catch(() => undefined);
      return;
    }
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}

async function* readNDJSON(res: Response, signal: AbortSignal): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    if (signal.aborted) {
      reader.cancel().catch(() => undefined);
      return;
    }
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

function splitSystem(messages: ChatMessage[]) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const rest = messages.filter((m) => m.role !== 'system') as { role: 'user' | 'assistant'; content: string }[];
  return { system, rest };
}

async function* streamAnthropic(cfg: ProviderSettings, messages: ChatMessage[], signal: AbortSignal, maxTokens: number): AsyncGenerator<string> {
  if (!cfg.anthropicKey) throw new ProviderError('anthropic', 'no API key set');
  const { system, rest } = splitSystem(messages);
  const res = await providerFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.anthropicKey,
      'anthropic-version': '2023-06-01',
      // Required when the call comes from a browser page (CORS); harmless from the desktop app.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: cfg.anthropicModel, max_tokens: maxTokens, ...(system ? { system } : {}), messages: rest, stream: true }),
  });
  if (!res.ok) throw new ProviderError('anthropic', `HTTP ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
  for await (const data of readSSE(res, signal)) {
    try {
      const evt = JSON.parse(data);
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') yield evt.delta.text as string;
      if (evt.type === 'error') throw new ProviderError('anthropic', evt.error?.message ?? 'stream error');
    } catch (e) {
      if (e instanceof ProviderError) throw e;
    }
  }
}

// OpenAI's newer models reason before answering, and those hidden tokens count
// toward max_completion_tokens (max_tokens is deprecated and rejected by
// reasoning models). The cap is only an upper bound, so leave room to think;
// the prompts themselves keep the visible answer short.
const OPENAI_MIN_COMPLETION_TOKENS = 2000;

async function* streamOpenAI(cfg: ProviderSettings, messages: ChatMessage[], signal: AbortSignal, maxTokens: number): AsyncGenerator<string> {
  if (!cfg.openaiKey) throw new ProviderError('openai', 'no API key set');
  const res = await providerFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.openaiKey}` },
    body: JSON.stringify({ model: cfg.openaiModel, messages, stream: true, max_completion_tokens: Math.max(maxTokens, OPENAI_MIN_COMPLETION_TOKENS) }),
  });
  if (!res.ok) throw new ProviderError('openai', `HTTP ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
  for await (const data of readSSE(res, signal)) {
    if (data === '[DONE]') return;
    try {
      const evt = JSON.parse(data);
      const piece = evt.choices?.[0]?.delta?.content;
      if (piece) yield piece as string;
    } catch {
      /* ignore keep-alive lines */
    }
  }
}

async function* streamOllama(cfg: ProviderSettings, messages: ChatMessage[], signal: AbortSignal, maxTokens: number): AsyncGenerator<string> {
  const base = cfg.ollamaUrl.replace(/\/$/, '');
  if (isDesktop() && !isThisComputer(base)) {
    throw new ProviderError('ollama', 'the desktop app connects to Ollama on this computer only (http://localhost or http://127.0.0.1)');
  }
  const res = await providerFetch(`${base}/api/chat`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: cfg.ollamaModel, messages, stream: true, options: { num_predict: maxTokens } }),
  });
  if (!res.ok) throw new ProviderError('ollama', `HTTP ${res.status}`);
  for await (const line of readNDJSON(res, signal)) {
    try {
      const evt = JSON.parse(line);
      if (evt.error) throw new ProviderError('ollama', evt.error);
      if (evt.message?.content) yield evt.message.content as string;
      if (evt.done) return;
    } catch (e) {
      if (e instanceof ProviderError) throw e;
    }
  }
}

export function modelFor(cfg: ProviderSettings, id: ProviderId): string {
  if (id === 'anthropic') return cfg.anthropicModel;
  if (id === 'openai') return cfg.openaiModel;
  if (id === 'ollama') return cfg.ollamaModel;
  return 'heuristic-v1';
}

export function streamFrom(id: Exclude<ProviderId, 'heuristic'>, cfg: ProviderSettings, messages: ChatMessage[], signal: AbortSignal, maxTokens = 400) {
  if (id === 'anthropic') return streamAnthropic(cfg, messages, signal, maxTokens);
  if (id === 'openai') return streamOpenAI(cfg, messages, signal, maxTokens);
  return streamOllama(cfg, messages, signal, maxTokens);
}

// Simulated streaming for locally generated text, so the UI behaves the same.
export async function* streamText(text: string, signal: AbortSignal): AsyncGenerator<string> {
  const parts = text.match(/\S+\s*/g) ?? [text];
  for (const p of parts) {
    if (signal.aborted) return;
    await sleep(18);
    yield p;
  }
}

export async function testProvider(id: ProviderId, cfg: ProviderSettings): Promise<{ ok: boolean; detail: string }> {
  if (id === 'heuristic') return { ok: true, detail: 'Built in, works offline.' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    let out = '';
    for await (const piece of streamFrom(id, cfg, [
      { role: 'system', content: 'Reply with the single word: ready' },
      { role: 'user', content: 'Are you there?' },
    ], ctrl.signal, 10)) {
      out += piece;
      if (out.length > 40) break;
    }
    return { ok: true, detail: out.trim() ? `Responded: "${out.trim().slice(0, 40)}"` : 'Connected (empty reply).' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (id === 'ollama' && !(e instanceof ProviderError) && /fetch|network|failed|sending request|connect/i.test(msg)) {
      return {
        ok: false,
        detail: isDesktop() ? 'Could not reach Ollama on this computer. Is it running?' : 'Could not reach Ollama. Is it running, and is OLLAMA_ORIGINS allowing this page?',
      };
    }
    return { ok: false, detail: ctrl.signal.aborted ? 'Timed out after 15 s.' : msg };
  } finally {
    clearTimeout(timer);
  }
}
