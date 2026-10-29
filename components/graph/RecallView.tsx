'use client';

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, MessageSquarePlus, Search, Trash2 } from 'lucide-react';
import { askJournal, chatMessages, deleteChat, listChats, providerLabel } from '@/lib/chat';
import { useUI } from '@/lib/store';
import { chapterByRecency, summarizeThread } from '@/lib/memory';
import { getDB } from '@/lib/db';
import type { ChatMessage } from '@/lib/types';
import { formatDay } from '@/lib/util';

// Below the lg breakpoint the three columns do not fit, so the view becomes one
// column that switches between the conversation and the threads.
type Pane = 'ask' | 'threads';
const PANES: { id: Pane; label: string }[] = [
  { id: 'ask', label: 'Ask' },
  { id: 'threads', label: 'Threads and chapters' },
];

const TOOL_LABEL: Record<string, string> = {
  search_journal: 'Searched your entries',
  find_moments: 'Looked for related moments',
  find_threads: 'Looked for recurring threads',
  get_chapter: 'Opened the latest chapter',
  answer_with_provider: 'Asked your AI provider',
};

// Says who wrote the answer and how much of the journal left the device for it.
function answerNote(m: ChatMessage): string {
  const sent = m.steps.reduce((n, s) => n + s.sentToProvider, 0);
  const passages = `${sent} passage${sent === 1 ? '' : 's'}`;
  if (m.fallbackUsed && sent) return `Your AI provider did not answer, so this is the built-in summary. ${passages} had been sent to it.`;
  if (m.fallbackUsed) return 'Your AI provider was not used, so this is the built-in summary. Nothing left this device.';
  if (!m.provider || m.provider === 'heuristic') return 'Built-in summary. Nothing left this device.';
  return `Written by ${providerLabel(m.provider)} (${m.model}) from ${passages} of your journal.`;
}

export default function RecallView() {
  const { settings, openEntry } = useUI();
  const chats = useLiveQuery(listChats, []);
  const [chatId, setChatId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>('ask');

  const msgs = useLiveQuery(() => (chatId ? chatMessages(chatId) : Promise.resolve([])), [chatId]);
  const threads = useLiveQuery(() => getDB().threads.orderBy('lastDay').reverse().toArray(), []);
  const chapters = useLiveQuery(async () => chapterByRecency(await getDB().chapters.toArray()), []);

  // The live query can briefly hold the previous chat's messages after a switch.
  const shown = (msgs ?? []).filter((m) => m.chatId === chatId);
  const canAsk = question.trim().length > 2 && !busy;
  const active = useMemo(() => chats?.find((c) => c.id === chatId) ?? null, [chats, chatId]);

  const onAsk = async () => {
    if (!canAsk) return;
    setBusy(true);
    setError(null);
    try {
      const out = await askJournal({ chatId, question, settings });
      setChatId(out.chat.id);
      setQuestion('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const newChat = () => {
    setChatId(null);
    setQuestion('');
    setPane('ask');
  };

  return (
    <div className="flex h-full min-h-0 flex-col lg:grid lg:grid-cols-[240px_minmax(0,1fr)_300px] xl:grid-cols-[260px_minmax(0,1fr)_320px]">
      <div className="space-y-2 border-b border-ink-800 p-2 lg:hidden">
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Recall panel" className="flex rounded-lg border border-ink-800 p-0.5">
            {PANES.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={pane === p.id}
                onClick={() => setPane(p.id)}
                className={`rounded-md px-3 py-1 text-[12.5px] ${pane === p.id ? 'bg-ink-850 text-paper-50' : 'text-paper-500 hover:text-paper-100'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={newChat}
            className="ml-auto inline-flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-[12.5px] text-paper-100 hover:bg-ink-850"
          >
            <MessageSquarePlus size={14} />
            <span className="sr-only min-[400px]:not-sr-only">New chat</span>
          </button>
        </div>
        {!!chats?.length && (
          <select
            aria-label="Earlier recall chats"
            value={chatId ?? ''}
            onChange={(e) => {
              setChatId(e.target.value || null);
              setPane('ask');
            }}
            className="w-full rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-[12.5px] text-paper-100 focus:border-ember-400 focus:outline-none"
          >
            <option value="">Earlier chats</option>
            {chats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        )}
      </div>

      <aside className="hidden min-h-0 flex-col border-r border-ink-800 p-3 lg:flex">
        <button
          type="button"
          onClick={newChat}
          className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[13px] text-paper-100 hover:bg-ink-850"
        >
          <MessageSquarePlus size={14} /> New recall chat
        </button>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto">
          {(chats ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setChatId(c.id)}
              className={`w-full rounded-lg px-2.5 py-2 text-left text-[12.5px] ${
                chatId === c.id ? 'bg-ink-850 text-paper-50' : 'text-paper-100 hover:bg-ink-900'
              }`}
            >
              <div className="truncate font-medium">{c.title}</div>
              <div className="mt-0.5 text-[11px] text-paper-500">{new Date(c.updatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</div>
            </button>
          ))}
        </div>
      </aside>

      <section className={`${pane === 'ask' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col lg:flex`}>
        <div className="border-b border-ink-800 p-3">
          <h2 className="font-serif text-lg text-paper-50">{active ? active.title : 'Ask your journal'}</h2>
          <p className="text-[12.5px] text-paper-300">Answers come only from your finished entries, with the passages they rest on.</p>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          {shown.map((m) => (
            <article key={m.id} className={`rounded-xl border px-3 py-2 ${m.role === 'assistant' ? 'border-ink-700 bg-ink-900/70' : 'border-ink-800 bg-ink-950'}`}>
              <header className="mb-1 flex items-center justify-between text-[11px] text-paper-500">
                <span>{m.role === 'assistant' ? 'Journal recall assistant' : 'You'}</span>
                <span>{new Date(m.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              </header>
              <p className="whitespace-pre-wrap text-[13.5px] leading-6 text-paper-100">{m.text}</p>
              {!!m.citations.length && (
                <div className="mt-2 space-y-1 rounded-lg border border-ink-700/80 bg-ink-950/70 p-2.5">
                  <div className="text-[11.5px] text-paper-500">From your entries</div>
                  {m.citations.map((c) => (
                    <button
                      key={`${m.id}-${c.n}`}
                      type="button"
                      onClick={() => openEntry(c.entryId)}
                      className="block w-full rounded px-1.5 py-1 text-left text-[12px] text-paper-100 hover:bg-ink-900"
                    >
                      <span className="mr-1 text-ember-300">[{c.n}]</span>
                      <span className="font-medium">{formatDay(c.localDay)}:</span> {c.snippet}
                    </button>
                  ))}
                </div>
              )}
              {m.role === 'assistant' && <p className="mt-2 text-[11.5px] text-paper-500" data-testid="answer-note">{answerNote(m)}</p>}
              {!!m.steps.length && (
                <details className="mt-1 text-[11.5px] text-paper-500">
                  <summary className="cursor-pointer select-none">How this answer was found</summary>
                  <ul className="mt-1 space-y-1">
                    {m.steps.map((s, i) => (
                      <li key={`${m.id}-s${i}`}>
                        <span className="text-paper-300">{TOOL_LABEL[s.tool] ?? s.tool}</span>: {s.resultSummary} ({s.ms} ms)
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          ))}
          {!shown.length && <p className="text-[13px] text-paper-500">Ask a question like “How have presentations gone, and what helped?”</p>}
        </div>

        <div className="border-t border-ink-800 p-3">
          {error && <p className="mb-2 text-[12.5px] text-rose-300">{error}</p>}
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-paper-500" />
              <input
                value={question}
                aria-label="Ask your journal"
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void onAsk();
                  }
                }}
                placeholder="Ask your journal..."
                className="w-full rounded-lg border border-ink-700 bg-ink-900 py-2 pl-8 pr-3 text-[13px] text-paper-50 placeholder:text-paper-500 focus:border-ember-400 focus:outline-none"
              />
            </div>
            <button
              type="button"
              disabled={!canAsk}
              onClick={() => void onAsk()}
              className="rounded-lg bg-ember-400 px-3 py-2 text-[12.5px] font-medium text-ink-950 hover:bg-ember-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Thinking…' : 'Ask'}
            </button>
            {chatId && (
              <button
                type="button"
                onClick={() => {
                  void deleteChat(chatId);
                  setChatId(null);
                }}
                className="rounded-lg border border-ink-700 px-2.5 py-2 text-paper-300 hover:bg-ink-900"
                aria-label="Delete this chat"
                title="Delete this chat"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      </section>

      <aside className={`${pane === 'threads' ? 'block' : 'hidden'} min-h-0 flex-1 overflow-auto p-3 lg:block lg:border-l lg:border-ink-800`}>
        <h3 className="mb-2 font-serif text-base text-paper-50">Threads</h3>
        <ul className="space-y-1 text-[12.5px]">
          {(threads ?? []).slice(0, 8).map((t) => (
            <li key={t.id} className="rounded-lg border border-ink-800 bg-ink-900/40 px-2.5 py-2 text-paper-100">
              <div className="font-medium">{t.title}</div>
              <div className="mt-0.5 text-[11.5px] text-paper-500">{summarizeThread(t)}</div>
            </li>
          ))}
        </ul>
        <h3 className="mb-2 mt-4 font-serif text-base text-paper-50">Chapters</h3>
        <ul className="space-y-1 text-[12.5px]">
          {(chapters ?? []).slice(0, 6).map((c) => (
            <li key={c.id} className="rounded-lg border border-ink-800 bg-ink-900/40 px-2.5 py-2 text-paper-100">
              <div className="inline-flex items-center gap-1">
                <BookOpen size={12} className="text-ember-300" />
                <span className="font-medium">{c.title}</span>
              </div>
              <div className="mt-0.5 text-[11.5px] text-paper-500">{c.narrative}</div>
              {c.carryForward && <div className="mt-1 text-[11.5px] text-paper-300">Your plan then: {c.carryForward}</div>}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
