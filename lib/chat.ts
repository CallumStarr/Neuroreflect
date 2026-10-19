// Recall: ask questions of your own journal. Every answer rests on passages
// retrieved on this device. With a cloud or Ollama provider configured, the
// numbered passages are sent to it and its answer is kept only if it cites
// them; otherwise the built-in summary answers. The tool trace records exactly
// how many passages left the device, including when the provider failed.

import { getDB } from './db';
import { ProviderError, modelFor, streamFrom, type ChatMessage as AIMessage } from './ai-provider';
import { decodeVec, hybridRank, terms } from './embeddings';
import { chapterByRecency, searchMemory, summarizeThread } from './memory';
import { composeSystem, getTemplate } from './prompts';
import { findFusionSpans } from './psych-engine';
import { systemPromptFor } from './templates';
import type { AppSettings, Chat, ChatMessage, Chapter, Citation, ProviderId, Thread, ToolStep } from './types';
import { uid } from './util';

const MAX_CITATIONS = 8;
const PROVIDER_TIMEOUT_MS = 45000;

function titleFromQuestion(q: string): string {
  const clean = q.replace(/\s+/g, ' ').trim();
  return clean.length <= 56 ? clean : `${clean.slice(0, 56).replace(/[ ,;:.!?]+$/, '')}…`;
}

function cite(n: number, entryId: string, localDay: string, blockId: string | null, snippet: string, title: string): Citation {
  return { n, entryId, localDay, blockId, snippet, title };
}

function nowIso() {
  return new Date().toISOString();
}

export function providerLabel(id: ProviderId): string {
  return id === 'anthropic' ? 'Anthropic' : id === 'openai' ? 'OpenAI' : id === 'ollama' ? 'Ollama' : 'the built-in engine';
}

export async function listChats(): Promise<Chat[]> {
  return getDB().chats.orderBy('updatedAt').reverse().toArray();
}

export async function ensureChat(chatId: string | null, firstQuestion: string): Promise<Chat> {
  const db = getDB();
  if (chatId) {
    const existing = await db.chats.get(chatId);
    if (existing) return existing;
  }
  const chat: Chat = { id: uid('c'), title: titleFromQuestion(firstQuestion), createdAt: nowIso(), updatedAt: nowIso() };
  await db.chats.add(chat);
  return chat;
}

export async function chatMessages(chatId: string): Promise<ChatMessage[]> {
  return getDB().chatMessages.where('chatId').equals(chatId).sortBy('createdAt');
}

// ---------- tools (all local) ----------

interface ToolResult {
  summary: string;
  citations: Citation[];
}

async function entryTitles(ids: string[]): Promise<Map<string, string>> {
  const entries = await getDB().entries.bulkGet([...new Set(ids)]);
  return new Map(entries.filter(Boolean).map((e) => [e!.id, e!.title || 'Untitled entry']));
}

async function toolSearchJournal(question: string, nStart: number): Promise<ToolResult> {
  const hits = await searchMemory(question, 6);
  const titles = await entryTitles(hits.map((h) => h.entryId));
  const citations = hits.map((h, i) => cite(nStart + i, h.entryId, h.localDay, h.blockId, h.snippet, titles.get(h.entryId) ?? 'Untitled entry'));
  const summary = citations.length
    ? `Found ${citations.length} relevant passages across ${new Set(citations.map((c) => c.entryId)).size} entries.`
    : 'No close journal passages matched this question.';
  return { summary, citations };
}

/** Moments ranked by the same hybrid search, skipping paragraphs already cited. */
async function toolFindMoments(question: string, alreadyCited: Set<string>, nStart: number): Promise<ToolResult> {
  const all = await getDB().moments.toArray();
  const candidates = all.filter((m) => !alreadyCited.has(`${m.entryId}|${m.blockId}`));
  const byId = new Map(candidates.map((m) => [m.id, m]));
  const ranked = hybridRank(
    candidates.map((m) => ({ id: m.id, text: `${m.title} ${m.text}`, vec: decodeVec(m.vec) })),
    question,
    3,
  );
  const rows = ranked.map((r) => byId.get(r.id)!).filter(Boolean);
  const titles = await entryTitles(rows.map((m) => m.entryId));
  const citations = rows.map((m, i) => cite(nStart + i, m.entryId, m.localDay, m.blockId, m.text, titles.get(m.entryId) ?? 'Untitled entry'));
  return {
    summary: rows.length ? `Found ${rows.length} more moments on the same subject.` : 'No further moments matched.',
    citations,
  };
}

/** Threads named in the question come first, then threads that run through the cited entries. */
async function toolFindThreads(question: string, citedEntries: Set<string>): Promise<{ summary: string; threads: Thread[] }> {
  const asked = new Set(terms(question));
  const scored = (await getDB().threads.toArray())
    .map((t) => {
      const named = terms(t.title).some((w) => asked.has(w));
      const overlap = t.entryIds.filter((id) => citedEntries.has(id)).length;
      return { t, named, score: (named ? 100 : 0) + overlap };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.t.entryIds.length - a.t.entryIds.length)
    .slice(0, 2);
  const named = scored.filter((s) => s.named).length;
  return {
    summary: scored.length
      ? named
        ? `${named} recurring thread${named === 1 ? '' : 's'} named in the question.`
        : `${scored.length} recurring thread${scored.length === 1 ? '' : 's'} run through these passages.`
      : 'No recurring thread runs through these passages.',
    threads: scored.map((s) => s.t),
  };
}

async function toolGetChapter(): Promise<{ summary: string; chapter: Chapter | null }> {
  const rows = chapterByRecency(await getDB().chapters.toArray());
  const chapter = rows[0] ?? null;
  return { summary: chapter ? `Opened the latest chapter (${chapter.title}).` : 'No chapter available yet.', chapter };
}

// ---------- answers ----------

function writeAnswer(args: { question: string; citations: Citation[]; threads: Thread[]; chapter: Chapter | null }): string {
  const lines: string[] = [];
  lines.push(`Here is what your journal says about: "${args.question.trim()}".`);
  if (args.citations.length) {
    lines.push('');
    lines.push('What I found in your entries:');
    for (const c of args.citations.slice(0, 4)) lines.push(`- [${c.n}] ${c.snippet}`);
  } else {
    lines.push('');
    lines.push('Nothing in your finished entries matched closely. Try different words, or finish a few more entries.');
  }
  if (args.threads.length) {
    lines.push('');
    lines.push('Running through these entries:');
    for (const t of args.threads) lines.push(`- ${summarizeThread(t)}`);
  }
  if (args.chapter) {
    lines.push('');
    lines.push(`Latest chapter, ${args.chapter.title}: ${args.chapter.narrative}`);
    if (args.chapter.carryForward) lines.push(`Carried forward: ${args.chapter.carryForward}`);
  }
  // Suggest a reframe only when a cited passage actually holds a fused thought.
  const fused = args.citations.slice(0, 4).find((c) => findFusionSpans([{ id: 'c', text: c.snippet }]).some((s) => !s.defused));
  if (fused) {
    lines.push('');
    lines.push(`Passage [${fused.n}] states a thought as fact. You could try rewriting it as "I'm noticing the thought that..." and see how it reads.`);
  }
  return lines.join('\n');
}

export function sanitizeCitations(text: string, max: number): { text: string; used: number[] } {
  const used = new Set<number>();
  const cleaned = text.replace(/\[(\d{1,2})\]/g, (_m, d: string) => {
    const n = Number(d);
    if (n >= 1 && n <= max) {
      used.add(n);
      return `[${n}]`;
    }
    return '';
  });
  const tidy = cleaned
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .trim();
  return { text: tidy, used: [...used].sort((a, b) => a - b) };
}

const PASSAGE_CHAR_BUDGET = 6000;
const HISTORY_PAIRS = 3;

/** Complete question-and-answer pairs only, so roles always alternate. */
function recentPairs(history: ChatMessage[]): AIMessage[] {
  const pairs: AIMessage[][] = [];
  for (let i = 0; i < history.length - 1; i++) {
    if (history[i].role === 'user' && history[i + 1].role === 'assistant') {
      pairs.push([
        { role: 'user', content: history[i].text.slice(0, 600) },
        { role: 'assistant', content: history[i + 1].text.slice(0, 600) },
      ]);
      i++;
    }
  }
  return pairs.slice(-HISTORY_PAIRS).flat();
}

function assembleChatPrompt(question: string, citations: Citation[], history: ChatMessage[], system: string): { messages: AIMessage[]; passages: number } {
  let budget = PASSAGE_CHAR_BUDGET;
  const passages: string[] = [];
  for (const c of citations) {
    const snippet = c.snippet.slice(0, Math.max(0, Math.min(700, budget)));
    if (!snippet) break;
    budget -= snippet.length;
    passages.push(`[${c.n}] (${c.localDay}, "${c.title}") ${snippet}`);
  }
  return {
    messages: [{ role: 'system', content: system }, ...recentPairs(history), { role: 'user', content: `Passages:\n${passages.join('\n')}\n\nQuestion: ${question}` }],
    passages: passages.length,
  };
}

/** The request sent to a provider. The shared safety and style rules always come first. */
export function buildChatPrompt(question: string, citations: Citation[], history: ChatMessage[], system = composeSystem(getTemplate('recall').body)): AIMessage[] {
  return assembleChatPrompt(question, citations, history, system).messages;
}

interface ProviderOutcome {
  answer: { text: string; used: number[] } | null;
  /** Passages placed in a request that went to the provider, answered or not. */
  passagesSent: number;
  failure: string;
}

async function providerAnswer(settings: AppSettings, question: string, citations: Citation[], history: ChatMessage[]): Promise<ProviderOutcome> {
  const id = settings.provider.primary;
  if (id === 'heuristic' || !citations.length) return { answer: null, passagesSent: 0, failure: '' };
  const { messages, passages } = assembleChatPrompt(question, citations, history, await systemPromptFor('recall'));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROVIDER_TIMEOUT_MS);
  try {
    let out = '';
    for await (const piece of streamFrom(id, settings.provider, messages, ctl.signal, 500)) out += piece;
    const clean = sanitizeCitations(out, passages);
    if (clean.text && clean.used.length) return { answer: clean, passagesSent: passages, failure: '' };
    return { answer: null, passagesSent: passages, failure: 'answered without citing the passages' };
  } catch (err) {
    console.warn('[NeuroReflect] journal chat provider failed, using heuristic answer:', err instanceof Error ? err.message : err);
    // A missing key fails before anything is sent; any other failure may come after the request left.
    const neverSent = err instanceof ProviderError && /no API key/.test(err.message);
    return { answer: null, passagesSent: neverSent ? 0 : passages, failure: neverSent ? 'has no API key set' : ctl.signal.aborted ? 'did not answer within 45 seconds' : 'did not answer' };
  } finally {
    clearTimeout(timer);
  }
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const out = await fn();
  return [out, Math.round(performance.now() - t0)];
}

export async function askJournal(input: { chatId: string | null; question: string; settings: AppSettings }): Promise<{ chat: Chat; user: ChatMessage; assistant: ChatMessage }> {
  const db = getDB();
  const question = input.question.trim();
  if (!question) throw new Error('Ask a question first.');
  const chat = await ensureChat(input.chatId, question);
  const history = input.chatId ? await chatMessages(chat.id) : [];
  const user: ChatMessage = {
    id: uid('cm'),
    chatId: chat.id,
    role: 'user',
    text: question,
    citations: [],
    steps: [],
    provider: null,
    model: '',
    fallbackUsed: false,
    incomplete: false,
    createdAt: nowIso(),
  };
  await db.chatMessages.add(user);

  const steps: ToolStep[] = [];
  const [search, msSearch] = await timed(() => toolSearchJournal(question, 1));
  steps.push({ tool: 'search_journal', args: { query: question, limit: 6 }, resultSummary: search.summary, sentToProvider: 0, ms: msSearch });

  const cited = new Set(search.citations.map((c) => `${c.entryId}|${c.blockId}`));
  const [moments, msMoments] = await timed(() => toolFindMoments(question, cited, search.citations.length + 1));
  steps.push({ tool: 'find_moments', args: { query: question }, resultSummary: moments.summary, sentToProvider: 0, ms: msMoments });

  const citations = [...search.citations, ...moments.citations].slice(0, MAX_CITATIONS).map((c, i) => ({ ...c, n: i + 1 }));
  const [threads, msThreads] = await timed(() => toolFindThreads(question, new Set(citations.map((c) => c.entryId))));
  steps.push({ tool: 'find_threads', args: { query: question }, resultSummary: threads.summary, sentToProvider: 0, ms: msThreads });

  const [chapter, msChapter] = await timed(() => toolGetChapter());
  steps.push({ tool: 'get_chapter', args: { latest: true }, resultSummary: chapter.summary, sentToProvider: 0, ms: msChapter });

  const configured = input.settings.provider.primary;
  const [outcome, msProvider] = await timed(() => providerAnswer(input.settings, question, citations, history));
  if (outcome.passagesSent > 0 || outcome.failure) {
    const who = providerLabel(configured);
    const n = outcome.passagesSent;
    steps.push({
      tool: 'answer_with_provider',
      args: { provider: configured, passages: n },
      resultSummary: outcome.answer
        ? `Sent ${n} passage${n === 1 ? '' : 's'} to ${who}; it answered.`
        : n > 0
          ? `Sent ${n} passage${n === 1 ? '' : 's'} to ${who}; it ${outcome.failure}, so the built-in summary is shown.`
          : `${who} ${outcome.failure}, so nothing was sent and the built-in summary is shown.`,
      sentToProvider: n,
      ms: msProvider,
    });
  }

  const usedProvider: ProviderId = outcome.answer ? configured : 'heuristic';
  const assistant: ChatMessage = {
    id: uid('cm'),
    chatId: chat.id,
    role: 'assistant',
    text: outcome.answer ? outcome.answer.text : writeAnswer({ question, citations, threads: threads.threads, chapter: chapter.chapter }),
    citations: outcome.answer ? citations.filter((c) => outcome.answer!.used.includes(c.n)) : citations,
    steps,
    provider: usedProvider,
    model: modelFor(input.settings.provider, usedProvider),
    fallbackUsed: configured !== 'heuristic' && citations.length > 0 && !outcome.answer,
    incomplete: false,
    createdAt: nowIso(),
  };
  const updatedAt = nowIso();
  await db.transaction('rw', [db.chatMessages, db.chats], async () => {
    await db.chatMessages.add(assistant);
    await db.chats.put({ ...chat, updatedAt });
  });
  return { chat: { ...chat, updatedAt }, user, assistant };
}

export async function deleteChat(chatId: string): Promise<void> {
  const db = getDB();
  await db.transaction('rw', [db.chats, db.chatMessages], async () => {
    await db.chats.delete(chatId);
    await db.chatMessages.where('chatId').equals(chatId).delete();
  });
}
