'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarClock, ChevronsRight, Layers, Mic, MicOff, X } from 'lucide-react';
import { getDB } from '@/lib/db';
import { registerBeforeLock } from '@/lib/lock';
import { runCopilot } from '@/lib/orchestrator';
import { COMPLETION_STEPS, completeEntry, newEntry, rebuildGraph, saveDraft, saveTelemetry, writeRevision } from '@/lib/pipeline';
import { computeTelemetry, detectFutureEvent, findCoarseLabels, nextRuminationState } from '@/lib/psych-engine';
import { useUI } from '@/lib/store';
import type { Anchor, Block, CopilotMode, Entry, LensId, Telemetry } from '@/lib/types';
import { isDesktop } from '@/lib/platform';
import { blocksToText, countWords, formatDay, sleep, uid } from '@/lib/util';
import BlockEditor, { type AnchoredQuestion, type FocusRequest } from './BlockEditor';
import CalibrationBanner from './CalibrationBanner';
import CopilotPane, { type CopilotTab, type FinishProgress, type StreamState } from './CopilotPane';
import EntryRail from './EntryRail';
import ForecastPanel from './ForecastPanel';
import LensPicker, { type PaletteAction } from './LensPicker';
import TelemetryBar, { type TraceSample } from './TelemetryBar';
import { useDictation } from './useDictation';

const TELEMETRY_DEBOUNCE_MS = 300;
const AUTOSAVE_DEBOUNCE_MS = 800;
const REVISION_INTERVAL_MS = 60000;
const IDLE_MS = 8000;
const IDLE_MIN_WORDS = 40;
const ACTIVE_WINDOW_MS = 30000;
const TRACE_LENGTH = 60;

const IDLE_STREAM: StreamState = { active: false, text: '', mode: null, lens: null };

function SessionTimer({ lastInputRef, secondsRef, frozen }: { lastInputRef: React.RefObject<number>; secondsRef: React.RefObject<number>; frozen: boolean }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      if (!frozen && document.visibilityState === 'visible' && Date.now() - (lastInputRef.current ?? 0) < ACTIVE_WINDOW_MS) {
        secondsRef.current = (secondsRef.current ?? 0) + 1;
      }
      force((n) => n + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [frozen, lastInputRef, secondsRef]);
  const s = secondsRef.current ?? 0;
  const m = Math.floor(s / 60);
  return (
    <span className="nr-num text-[12.5px] text-paper-500" title="Active writing time. Pauses after 30 seconds without typing.">
      {m}:{String(s % 60).padStart(2, '0')}
    </span>
  );
}

export default function Studio() {
  const { activeEntryId, openEntry, settings } = useUI();
  const thresholds = settings.thresholds;

  const [entry, setEntry] = useState<Entry | null>(null);
  const persistedRef = useRef(false);
  const loadedIdRef = useRef<string | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry>(() => computeTelemetry([{ id: 'x', text: '' }], thresholds));
  const [trace, setTrace] = useState<TraceSample[]>([]);
  const [rumination, setRumination] = useState({ active: false, clearPasses: 0 });
  const caretRef = useRef<Anchor | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [stream, setStream] = useState<StreamState>(IDLE_STREAM);
  const abortRef = useRef<AbortController | null>(null);
  const streamPromiseRef = useRef<Promise<unknown> | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const [copilotTab, setCopilotTab] = useState<CopilotTab>('inquiry');
  const [copilotCollapsed, setCopilotCollapsed] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [showForecast, setShowForecast] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [finish, setFinish] = useState<FinishProgress>({ running: false, steps: [] });
  const [idle, setIdle] = useState(false);
  const [eventChipDismissed, setEventChipDismissed] = useState(false);
  const lastInputRef = useRef<number>(Date.now());
  const secondsRef = useRef<number>(0);
  const dirtyRef = useRef(false);
  const revisionDirtyRef = useRef(false);

  // ---------- loading ----------
  useEffect(() => {
    if (activeEntryId && activeEntryId === loadedIdRef.current) return;
    abortRef.current?.abort();
    let cancelled = false;
    (async () => {
      let e: Entry | undefined;
      if (activeEntryId) e = await getDB().entries.get(activeEntryId);
      if (cancelled) return;
      const next = e ?? newEntry();
      persistedRef.current = Boolean(e);
      loadedIdRef.current = next.id;
      secondsRef.current = next.activeSeconds;
      dirtyRef.current = false;
      setEntry(next);
      const t = computeTelemetry(next.blocks, thresholds);
      setTelemetry(t);
      setTrace([{ iTalk: t.iTalkDensity, cog: t.cogProcDensity, neg: t.negAffectDensity, fusion: t.fusionScore, gran: t.granularityIndex }]);
      setRumination({ active: t.ruminationFlag, clearPasses: 0 });
      setStream(IDLE_STREAM);
      setPendingAnchor(null);
      setEventChipDismissed(false);
      setFinish({ running: false, steps: [] });
      setCopilotTab(next.status === 'complete' ? 'synthesis' : 'inquiry');
      if (next.status === 'draft') {
        const last = next.blocks[next.blocks.length - 1];
        setFocusRequest({ blockId: last.id, offset: last.text.length, nonce: Date.now() });
      }
    })();
    return () => {
      cancelled = true;
    };
    // thresholds intentionally excluded: they only affect recomputation below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEntryId]);

  // ---------- editing ----------
  const updateEntry = useCallback((patch: Partial<Entry>) => {
    setEntry((e) => (e ? { ...e, ...patch } : e));
    dirtyRef.current = true;
    revisionDirtyRef.current = true;
  }, []);

  const onBlocks = useCallback((blocks: Block[]) => updateEntry({ blocks }), [updateEntry]);
  const onActivity = useCallback(() => {
    lastInputRef.current = Date.now();
    setIdle(false);
  }, []);
  const onCaret = useCallback((a: Anchor | null) => {
    caretRef.current = a;
  }, []);

  const blocksKey = entry ? entry.blocks.map((b) => b.text).join('\u0001') : '';

  // Telemetry: recompute 300 ms after typing stops.
  useEffect(() => {
    if (!entry) return;
    const t = setTimeout(() => {
      const next = computeTelemetry(entry.blocks, thresholds);
      setTelemetry(next);
      setTrace((tr) => [...tr, { iTalk: next.iTalkDensity, cog: next.cogProcDensity, neg: next.negAffectDensity, fusion: next.fusionScore, gran: next.granularityIndex }].slice(-TRACE_LENGTH));
      setRumination((r) => nextRuminationState(r.active, r.clearPasses, next.ruminationFlag));
    }, TELEMETRY_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocksKey, thresholds]);

  const persistNow = useCallback(async (e: Entry): Promise<void> => {
    const toSave = { ...e, activeSeconds: secondsRef.current };
    await saveDraft(toSave);
    const words = countWords(blocksToText(e.blocks));
    if (words > 0) await saveTelemetry(e, computeTelemetry(e.blocks, thresholds));
    dirtyRef.current = false;
    if (!persistedRef.current) {
      persistedRef.current = true;
      loadedIdRef.current = e.id;
      openEntry(e.id);
    }
  }, [openEntry, thresholds]);

  // Autosave 800 ms after the last change. Empty new entries are never stored.
  useEffect(() => {
    if (!entry || !dirtyRef.current) return;
    const hasContent = entry.title.trim().length > 0 || entry.blocks.some((b) => b.text.trim().length > 0);
    if (!persistedRef.current && !hasContent) return;
    const t = setTimeout(() => {
      persistNow(entry).catch((err) => console.error('[NeuroReflect] autosave failed', err));
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [entry, persistNow]);

  // Revisions: one snapshot per minute of editing, not per keystroke.
  const entryRef = useRef(entry);
  entryRef.current = entry;
  useEffect(() => {
    const t = setInterval(() => {
      const e = entryRef.current;
      if (e && persistedRef.current && revisionDirtyRef.current) {
        revisionDirtyRef.current = false;
        writeRevision(e).catch(() => undefined);
      }
    }, REVISION_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  // Save on tab close or switching away, so nothing typed is lost.
  useEffect(() => {
    const flush = () => {
      const e = entryRef.current;
      if (e && dirtyRef.current && (persistedRef.current || e.blocks.some((b) => b.text.trim()))) void persistNow(e);
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      flush();
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [persistNow]);

  // Idle detection: reveal "Go deeper" after a pause, never send anything by itself.
  useEffect(() => {
    const t = setInterval(() => {
      const shouldIdle = Date.now() - lastInputRef.current > IDLE_MS && telemetry.wordCount >= IDLE_MIN_WORDS && !stream.active;
      setIdle((prev) => (prev !== shouldIdle ? shouldIdle : prev));
    }, 1000);
    return () => clearInterval(t);
  }, [telemetry.wordCount, stream.active]);

  const ensurePersisted = useCallback(async (): Promise<string> => {
    const e = entryRef.current;
    if (!e) throw new Error('no entry');
    if (!persistedRef.current || dirtyRef.current) await persistNow(e);
    return e.id;
  }, [persistNow]);

  // ---------- co-pilot ----------
  const requestCopilot = useCallback(
    async (mode: CopilotMode, lens: LensId | null = null) => {
      const e = entryRef.current;
      if (!e || abortRef.current) return;
      if (countWords(blocksToText(e.blocks)) < (mode === 'lens' ? 15 : 8)) return;
      const entryId = await ensurePersisted();
      let anchorId: string | null = null;
      if (mode === 'socratic' || mode === 'distancing') {
        const caretBlock = caretRef.current?.blockId;
        const blocks = e.blocks;
        let idx = blocks.findIndex((b) => b.id === caretBlock);
        if (idx < 0) idx = blocks.length - 1;
        // Skip past trailing empty paragraphs so the question follows real text.
        while (idx > 0 && !blocks[idx].text.trim()) idx--;
        const answer: Block = { id: uid('b'), text: '' };
        const nextBlocks = [...blocks.slice(0, idx + 1), answer, ...blocks.slice(idx + 1)];
        updateEntry({ blocks: nextBlocks });
        anchorId = answer.id;
        setPendingAnchor(answer.id);
        setFocusRequest({ blockId: answer.id, offset: 0, nonce: Date.now() });
      }
      setCopilotTab(mode === 'lens' ? 'lenses' : 'inquiry');
      setCopilotCollapsed(false);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStream({ active: true, text: '', mode, lens });
      try {
        const running = runCopilot({
          entryId,
          mode,
          lens,
          blocks: e.blocks,
          anchorBlockId: anchorId,
          telemetry: computeTelemetry(e.blocks, thresholds),
          settings,
          signal: ctrl.signal,
          onToken: (text) => setStream((s) => ({ ...s, text })),
        });
        streamPromiseRef.current = running;
        const turn = await running;
        if (!turn.text && anchorId) {
          const id = anchorId;
          setEntry((cur) => (cur ? { ...cur, blocks: cur.blocks.filter((b) => b.id !== id || b.text.trim()) } : cur));
        }
      } catch (err) {
        console.error('[NeuroReflect] co-pilot failed', err);
      } finally {
        abortRef.current = null;
        streamPromiseRef.current = null;
        setStream(IDLE_STREAM);
        setPendingAnchor(null);
      }
    },
    [ensurePersisted, settings, thresholds, updateEntry],
  );

  const cancelStream = useCallback(() => abortRef.current?.abort(), []);

  const runFinish = useCallback(async () => {
    const e = entryRef.current;
    if (!e || finish.running) return;
    if (countWords(blocksToText(e.blocks)) === 0) return;
    abortRef.current?.abort();
    setCopilotTab('synthesis');
    setCopilotCollapsed(false);
    setFinish({ running: true, steps: COMPLETION_STEPS.map((label) => ({ label, done: false })) });
    // Drop empty paragraphs that carry no question.
    const turns = await getDB().copilotTurns.where('entryId').equals(e.id).toArray();
    const anchoredIds = new Set(turns.map((t) => t.anchor?.blockId).filter(Boolean) as string[]);
    const cleaned = e.blocks.filter((b, i) => b.text.trim() || anchoredIds.has(b.id) || i === 0);
    const toFinish: Entry = { ...e, blocks: cleaned.length ? cleaned : e.blocks, activeSeconds: secondsRef.current };
    try {
      await completeEntry(toFinish, (done) =>
        setFinish((f) => ({ ...f, steps: f.steps.map((s, i) => (i <= done ? { ...s, done: true } : s)) })),
      );
      persistedRef.current = true;
      dirtyRef.current = false;
      loadedIdRef.current = toFinish.id;
      setEntry({ ...toFinish, status: 'complete' });
      if (activeEntryId !== toFinish.id) openEntry(toFinish.id);
    } catch (err) {
      console.error('[NeuroReflect] finishing failed', err);
    } finally {
      setFinish((f) => ({ ...f, running: false }));
    }
  }, [activeEntryId, finish.running, openEntry]);

  const flushPending = useCallback(async () => {
    const e = entryRef.current;
    if (e && dirtyRef.current && (persistedRef.current || e.blocks.some((b) => b.text.trim()))) await persistNow(e);
  }, [persistNow]);

  // Before the journal locks: stop any prompt mid-stream (keeping what
  // arrived) and save unsaved text while the key is still available.
  useEffect(
    () =>
      registerBeforeLock(async () => {
        abortRef.current?.abort();
        const running = streamPromiseRef.current;
        if (running) await Promise.race([running.catch(() => undefined), sleep(3000)]);
        await flushPending();
      }),
    [flushPending],
  );

  const openFromRail = useCallback(
    async (id: string) => {
      if (id === entryRef.current?.id) return;
      await flushPending();
      openEntry(id);
    },
    [flushPending, openEntry],
  );

  const newEntryNow = useCallback(() => {
    void flushPending();
    loadedIdRef.current = null;
    openEntry(null);
    // openEntry(null) may not change state if already null; force a fresh entry.
    const fresh = newEntry();
    persistedRef.current = false;
    loadedIdRef.current = fresh.id;
    secondsRef.current = 0;
    dirtyRef.current = false;
    setEntry(fresh);
    setTelemetry(computeTelemetry(fresh.blocks, thresholds));
    setTrace([]);
    setRumination({ active: false, clearPasses: 0 });
    setCopilotTab('inquiry');
    setFinish({ running: false, steps: [] });
    setFocusRequest({ blockId: fresh.blocks[0].id, offset: 0, nonce: Date.now() });
  }, [flushPending, openEntry, thresholds]);

  // ---------- text insertion helpers ----------
  const insertAtCaret = useCallback(
    (text: string, source: 'typed' | 'dictated' = 'typed') => {
      const e = entryRef.current;
      if (!e) return;
      const caret = caretRef.current;
      const blocks = e.blocks.slice();
      let idx = caret ? blocks.findIndex((b) => b.id === caret.blockId) : -1;
      if (idx < 0) idx = blocks.length - 1;
      const b = blocks[idx];
      const offset = caret && caret.blockId === b.id ? Math.min(caret.offset, b.text.length) : b.text.length;
      const before = b.text.slice(0, offset);
      const after = b.text.slice(offset);
      const lead = before && !/\s$/.test(before) ? ' ' : '';
      const trail = after && !/^\s/.test(after) ? ' ' : '';
      blocks[idx] = { ...b, text: before + lead + text + trail + after };
      const newOffset = (before + lead + text).length;
      caretRef.current = { blockId: b.id, offset: newOffset };
      const sources = source === 'dictated' && !e.inputSources.includes('dictated') ? [...e.inputSources, 'dictated' as const] : e.inputSources;
      updateEntry({ blocks, inputSources: sources });
      onActivity();
      setFocusRequest({ blockId: b.id, offset: newOffset, nonce: Date.now() });
    },
    [onActivity, updateEntry],
  );

  const replaceCoarse = useCallback(
    (word: string, term: string) => {
      const e = entryRef.current;
      if (!e) return;
      const span = findCoarseLabels(e.blocks).find((s) => s.word.toLowerCase() === word.toLowerCase());
      if (!span) return;
      const blocks = e.blocks.map((b) => (b.id === span.blockId ? { ...b, text: b.text.slice(0, span.start) + term + b.text.slice(span.end) } : b));
      updateEntry({ blocks });
      onActivity();
    },
    [onActivity, updateEntry],
  );

  const dictation = useDictation((text) => insertAtCaret(text, 'dictated'));
  // The desktop app's webview has no dependable speech recognition, so it offers
  // no dictation until on-device transcription replaces it. Set after mount: the
  // static HTML is the same for both.
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(isDesktop()), []);

  // ---------- keyboard ----------
  const handlersRef = useRef({ requestCopilot, runFinish, newEntryNow, rumination });
  handlersRef.current = { requestCopilot, runFinish, newEntryNow, rumination };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const h = handlersRef.current;
      if (mod && e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        void h.runFinish();
      } else if (mod && e.key === 'Enter') {
        e.preventDefault();
        void h.requestCopilot(h.rumination.active ? 'distancing' : 'socratic');
      } else if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setShowPalette((v) => !v);
      } else if (e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        h.newEntryNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onPalette = useCallback(
    (a: PaletteAction) => {
      setShowPalette(false);
      if (a.kind === 'lens') void requestCopilot('lens', a.lens);
      else if (a.kind === 'deeper') void requestCopilot(rumination.active ? 'distancing' : 'socratic');
      else if (a.kind === 'stepback') void requestCopilot('distancing');
      else if (a.kind === 'finish') void runFinish();
      else if (a.kind === 'forecast') setShowForecast(true);
    },
    [requestCopilot, rumination.active, runFinish],
  );

  // ---------- live data for the side panes ----------
  const entryId = entry?.id ?? '';
  const turns = useLiveQuery(() => (entryId ? getDB().copilotTurns.where('entryId').equals(entryId).sortBy('createdAt') : []), [entryId]) ?? [];
  const synthesis = useLiveQuery(() => (entryId ? getDB().syntheses.get(entryId) : undefined), [entryId]);
  const values = useLiveQuery(() => getDB().coreValues.orderBy('order').toArray(), []) ?? [];
  const alignments = useLiveQuery(() => (entryId ? getDB().valueAlignments.where('entryId').equals(entryId).toArray() : []), [entryId]) ?? [];
  const mentions =
    useLiveQuery(async () => {
      if (!entryId) return [];
      const db = getDB();
      const ms = await db.mentions.where('entryId').equals(entryId).toArray();
      const nodes = await db.nodes.bulkGet(ms.map((m) => m.nodeId));
      return ms.map((m, i) => ({ ...m, node: nodes[i] ?? undefined })).filter((m) => m.node);
    }, [entryId]) ?? [];
  const forecasts = useLiveQuery(() => (entryId ? getDB().forecasts.where('entryId').equals(entryId).toArray() : []), [entryId]) ?? [];

  const anchored = useMemo(() => {
    const map: Record<string, AnchoredQuestion> = {};
    for (const t of turns) {
      if ((t.mode === 'socratic' || t.mode === 'distancing') && t.anchor) map[t.anchor.blockId] = { text: t.text, mode: t.mode, streaming: false };
    }
    if (pendingAnchor && stream.active) {
      map[pendingAnchor] = { text: stream.text, mode: stream.mode === 'distancing' ? 'distancing' : 'socratic', streaming: true };
    }
    return map;
  }, [turns, pendingAnchor, stream]);

  const confirmMention = useCallback(async (id: string) => {
    await getDB().mentions.update(id, { confirmed: true });
  }, []);
  const removeMention = useCallback(async (id: string) => {
    await getDB().mentions.delete(id);
    await rebuildGraph();
  }, []);

  if (!entry) return null;

  const words = countWords(blocksToText(entry.blocks));
  const showEventChip = !eventChipDismissed && forecasts.length === 0 && entry.status === 'draft' && words > 10 && detectFutureEvent(blocksToText(entry.blocks));

  return (
    <div className="flex h-full">
      {railCollapsed ? (
        <div className="flex w-10 shrink-0 flex-col items-center border-r border-ink-800 bg-ink-950 pt-4">
          <button type="button" onClick={() => setRailCollapsed(false)} title="Show entries" className="rounded p-2 text-paper-500 hover:bg-ink-900 hover:text-paper-100">
            <ChevronsRight size={15} />
          </button>
        </div>
      ) : (
        <EntryRail activeId={entry.id} onOpen={(id) => void openFromRail(id)} onNew={newEntryNow} onCollapse={() => setRailCollapsed(true)} />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ink-800 px-6">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-paper-300">
                  {formatDay(entry.localDay, { weekday: 'long', day: 'numeric', month: 'long' })}
                  <span className="text-paper-500">{entry.status === 'complete' ? ', finished' : persistedRef.current ? ', saved as draft' : ''}</span>
                </p>
              </div>
              <span className="nr-num text-[12.5px] text-paper-500">{words} words</span>
              <SessionTimer lastInputRef={lastInputRef} secondsRef={secondsRef} frozen={finish.running} />
              <div className="mx-1 h-5 w-px bg-ink-800" />
              {!desktop && (
                <button
                  type="button"
                  onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
                  disabled={!dictation.supported}
                  aria-pressed={dictation.listening}
                  title={
                    dictation.supported
                      ? 'Dictate into the entry. Uses your browser speech service; in Chrome and Edge, audio is processed by the browser vendor online.'
                      : 'Dictation needs a browser with the Web Speech API, such as Chrome or Edge.'
                  }
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] disabled:cursor-not-allowed disabled:opacity-40 ${
                    dictation.listening ? 'bg-rose-400/15 text-rose-300' : 'text-paper-300 hover:bg-ink-900'
                  }`}
                >
                  {dictation.listening ? <MicOff size={14} /> : <Mic size={14} />}
                  {dictation.listening ? 'Stop' : 'Dictate'}
                </button>
              )}
              <button type="button" onClick={() => setShowForecast((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-paper-300 hover:bg-ink-900">
                <CalendarClock size={14} /> Forecast
              </button>
              <button type="button" onClick={() => setShowPalette(true)} title="Mental model lenses (Ctrl+K)" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-paper-300 hover:bg-ink-900">
                <Layers size={14} /> Lenses
              </button>
              <button
                type="button"
                onClick={() => void runFinish()}
                disabled={words === 0 || finish.running}
                title="Finish entry (Ctrl+Shift+Enter)"
                className="rounded-lg bg-ember-400 px-3 py-1.5 text-[12.5px] font-medium text-ink-950 hover:bg-ember-300 disabled:opacity-40"
              >
                {entry.status === 'complete' ? 'Re-finish' : 'Finish'}
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto" id="editor-scroll">
              <CalibrationBanner />
              <div className="mx-auto w-full max-w-[720px] px-10 pb-48 pt-10">
                {(forecasts.length > 0 || showEventChip) && (
                  <div className="mb-6 flex flex-wrap items-center gap-2">
                    {forecasts.map((f) => (
                      <span key={f.id} className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 px-2.5 py-1 text-[12px] text-paper-300">
                        <CalendarClock size={12} className="text-dusk-400" />
                        {f.eventName}, {formatDay(f.targetDate)}
                        {f.calibratedAt ? <span className="text-paper-500">, checked</span> : <span className="text-paper-500">, dread {f.predictedDread}</span>}
                      </span>
                    ))}
                    {showEventChip && (
                      <span className="inline-flex items-center gap-2 rounded-full border border-dashed border-dusk-400/60 py-1 pl-3 pr-1.5 text-[12px] text-paper-300">
                        Something coming up? Forecast it now and check your prediction afterwards.
                        <button type="button" onClick={() => setShowForecast(true)} className="rounded-full bg-dusk-400/20 px-2 py-0.5 text-paper-50 hover:bg-dusk-400/30">
                          Forecast it
                        </button>
                        <button type="button" aria-label="Dismiss" onClick={() => setEventChipDismissed(true)} className="rounded-full p-0.5 text-paper-500 hover:text-paper-100">
                          <X size={12} />
                        </button>
                      </span>
                    )}
                  </div>
                )}

                <input
                  value={entry.title}
                  onChange={(e) => {
                    updateEntry({ title: e.target.value });
                    onActivity();
                  }}
                  placeholder="Untitled entry"
                  aria-label="Entry title"
                  className="mb-8 w-full bg-transparent font-serif text-[2rem] font-medium leading-tight text-paper-50 placeholder:text-ink-600 focus:outline-none"
                  style={{ fontVariationSettings: "'opsz' 36" }}
                />

                <BlockEditor blocks={entry.blocks} onChange={onBlocks} onCaret={onCaret} onActivity={onActivity} focusRequest={focusRequest} anchored={anchored} />

                {(dictation.interim || dictation.error) && (
                  <p className={`mt-2 text-[13px] ${dictation.error ? 'text-rose-300' : 'italic text-paper-500'}`}>{dictation.error ?? dictation.interim}</p>
                )}
                {idle && !stream.active && entry.status === 'draft' && (
                  <p className="nr-rise mt-4 text-[13px] text-paper-500">
                    Pausing is fine. When you want a question, press <kbd className="text-paper-300">Ctrl Enter</kbd>.
                  </p>
                )}
              </div>
            </div>
          </div>

          <CopilotPane
            collapsed={copilotCollapsed}
            onToggle={() => setCopilotCollapsed((v) => !v)}
            tab={copilotTab}
            setTab={setCopilotTab}
            entry={{ ...entry, wordCount: words }}
            turns={turns}
            stream={stream}
            ruminationActive={rumination.active}
            suggestDeeper={idle}
            telemetry={telemetry}
            synthesis={synthesis}
            values={values}
            alignments={alignments}
            mentions={mentions}
            finish={finish}
            onGoDeeper={() => void requestCopilot('socratic')}
            onStepBack={() => void requestCopilot('distancing')}
            onLens={(l) => void requestCopilot('lens', l)}
            onCancel={cancelStream}
            onFinish={() => void runFinish()}
            onReplaceCoarse={replaceCoarse}
            onInsertTerm={(t) => insertAtCaret(t)}
            onConfirmMention={confirmMention}
            onRemoveMention={removeMention}
          />

          {showForecast && (
            <ForecastPanel
              entryId={persistedRef.current ? entry.id : null}
              ensureEntry={ensurePersisted}
              onClose={() => setShowForecast(false)}
              onSaved={() => setShowForecast(false)}
            />
          )}
        </div>

        <TelemetryBar telemetry={telemetry} trace={trace} thresholds={thresholds} ruminationActive={rumination.active} onStepBack={() => void requestCopilot('distancing')} busy={stream.active} />
      </div>

      {showPalette && <LensPicker onPick={onPalette} onClose={() => setShowPalette(false)} />}
    </div>
  );
}
