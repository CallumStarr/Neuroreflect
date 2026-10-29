'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarClock, ChevronsRight, Layers, MessageCircleQuestion, Mic, MicOff, X } from 'lucide-react';
import { getDB, saveSettings } from '@/lib/db';
import { recordFeeling } from '@/lib/feelings';
import { comingUpForJournal, liveOffer, loadGuidanceContext, pickStarter, type GuidanceContext, type StarterPick, type TechniqueOffer } from '@/lib/guidance';
import { registerBeforeLock } from '@/lib/lock';
import { describeRepeat, describeWhen } from '@/lib/nl-date';
import { findTaskSuggestions, type TaskSuggestion } from '@/lib/one-tap';
import { runCopilot } from '@/lib/orchestrator';
import { COMPLETION_STEPS, completeEntry, newEntry, rebuildGraph, saveDraft, saveTelemetry, writeRevision } from '@/lib/pipeline';
import { addTask, deleteTask } from '@/lib/planner';
import { computeTelemetry, detectFutureEvent, findCoarseLabels, nextRuminationState } from '@/lib/psych-engine';
import { mentionsCrisis } from '@/lib/safety';
import { useUI } from '@/lib/store';
import { getTechnique, techniqueEnabled } from '@/lib/techniques';
import type { Anchor, Block, CopilotMode, CopilotTurn, Entry, EntryExercise, EntryPrompt, GuidanceLevel, LensId, Telemetry, TechniqueId } from '@/lib/types';
import { isDesktop } from '@/lib/platform';
import { blocksToText, countWords, formatDay, sleep, uid } from '@/lib/util';
import GoalsSetup from '../GoalsSetup';
import BlockEditor, { type AnchoredQuestion, type FocusRequest, type OneTapProps } from './BlockEditor';
import CalibrationBanner from './CalibrationBanner';
import CopilotPane, { type CopilotTab, type FinishProgress, type StreamState } from './CopilotPane';
import EntryRail from './EntryRail';
import ExerciseRunner from './ExerciseRunner';
import ForecastPanel from './ForecastPanel';
import { ComingUpStrip, CrisisCard, GuidanceSlider, NextTimeCheck, OfferChip, PromptCard, TomorrowList } from './GuidanceParts';
import LensPicker, { type PaletteAction } from './LensPicker';
import type { AddedNote } from './OneTapChip';
import TelemetryBar, { type TraceSample } from './TelemetryBar';
import { useDictation } from './useDictation';
import { useMediaQuery } from '../useMediaQuery';

const TELEMETRY_DEBOUNCE_MS = 300;
const AUTOSAVE_DEBOUNCE_MS = 800;
const REVISION_INTERVAL_MS = 60000;
const IDLE_MS = 8000;
const IDLE_MIN_WORDS = 40;
const ACTIVE_WINDOW_MS = 30000;
const TRACE_LENGTH = 60;
// One-tap and live offers wait for a pause, so they never interrupt a sentence.
const SUGGEST_PAUSE_MS = 1200;
const OFFER_PAUSE_MS = 3000;

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

function addedLabel(s: TaskSuggestion, keepDate: boolean): string {
  if (!keepDate || !s.when) return `Added "${s.title}" to Later`;
  if (s.when.repeat) return `Added "${s.title}", ${describeRepeat(s.when.repeat.rule, s.when.repeat.fromCompletion).toLowerCase()}`;
  return `Added "${s.title}" for ${describeWhen(s.when.day, s.when.time).replace(/^(Today|Tomorrow|Yesterday)/, (m) => m.toLowerCase())}`;
}

export default function Studio() {
  const { activeEntryId, openEntry, settings, setSettings, setTab, setHelpOpen, openTask, newEntryNonce, takePendingPrompt } = useUI();
  const thresholds = settings.thresholds;
  const level: GuidanceLevel = settings.guidance.level;
  const blank = level === 'blank';
  const guided = level === 'guided' || level === 'deep';
  const narrow = !useMediaQuery('(min-width: 900px)');

  const [entry, setEntry] = useState<Entry | null>(null);
  const persistedRef = useRef(false);
  const loadedIdRef = useRef<string | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry>(() => computeTelemetry([{ id: 'x', text: '' }], thresholds));
  const [trace, setTrace] = useState<TraceSample[]>([]);
  const [rumination, setRumination] = useState({ active: false, clearPasses: 0 });
  // The step-back alert is a suggestion: Guided and Deep offer it, and it can be
  // hidden for the rest of an entry. The guard behind it never switches off.
  const [stepBackDismissed, setStepBackDismissed] = useState(false);
  const stepBackActive = rumination.active && guided && !stepBackDismissed;
  const caretRef = useRef<Anchor | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [stream, setStream] = useState<StreamState>(IDLE_STREAM);
  const abortRef = useRef<AbortController | null>(null);
  const streamPromiseRef = useRef<Promise<unknown> | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const [copilotTab, setCopilotTab] = useState<CopilotTab>('inquiry');
  const [copilotCollapsed, setCopilotCollapsed] = useState(level === 'open' || narrow);
  const [railCollapsed, setRailCollapsed] = useState(narrow);
  const [showForecast, setShowForecast] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [finish, setFinish] = useState<FinishProgress>({ running: false, steps: [] });
  const [idle, setIdle] = useState(false);
  const [paused, setPaused] = useState<{ short: boolean; offer: boolean }>({ short: false, offer: false });
  const [eventChipDismissed, setEventChipDismissed] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  // Guidance for this entry: the starter prompt and any technique offers.
  const [guidanceCtx, setGuidanceCtx] = useState<GuidanceContext | null>(null);
  const [starter, setStarter] = useState<{ pick: StarterPick; index: number } | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<EntryPrompt | null>(null);
  const [promptHidden, setPromptHidden] = useState(false);
  const [dismissedOffers, setDismissedOffers] = useState<Set<TechniqueId>>(new Set());
  const [crisisHidden, setCrisisHidden] = useState(false);
  const [crisis, setCrisis] = useState(false);
  const [nextCheckDone, setNextCheckDone] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, TaskSuggestion[]>>({});
  const [added, setAdded] = useState<Record<string, AddedNote>>({});
  const lastInputRef = useRef<number>(Date.now());
  const secondsRef = useRef<number>(0);
  const dirtyRef = useRef(false);
  const revisionDirtyRef = useRef(false);
  const guardModeRef = useRef<'distancing' | 'concrete'>('concrete');

  // The prompt on screen, which is saved with the entry once writing starts.
  const shownPrompt: EntryPrompt | null = entry?.prompt ?? (promptHidden ? null : (pendingPrompt ?? starter?.pick.prompts[starter.index] ?? null));
  const shownPromptRef = useRef<EntryPrompt | null>(null);
  shownPromptRef.current = shownPrompt;

  // ---------- loading ----------
  const resetForEntry = useCallback(
    (next: Entry) => {
      secondsRef.current = next.activeSeconds;
      dirtyRef.current = false;
      setEntry(next);
      const t = computeTelemetry(next.blocks, thresholds);
      setTelemetry(t);
      setTrace([{ iTalk: t.iTalkDensity, cog: t.cogProcDensity, neg: t.negAffectDensity, fusion: t.fusionScore, gran: t.granularityIndex }]);
      setRumination({ active: t.ruminationFlag, clearPasses: 0 });
      setStepBackDismissed(false);
      setStream(IDLE_STREAM);
      setPendingAnchor(null);
      setEventChipDismissed(false);
      setFinish({ running: false, steps: [] });
      setCopilotTab(next.status === 'complete' ? 'synthesis' : 'inquiry');
      setStarter(null);
      setPromptHidden(false);
      setDismissedOffers(new Set());
      setCrisisHidden(false);
      setNextCheckDone(false);
      setSuggestions({});
      setAdded({});
    },
    [thresholds],
  );

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
      resetForEntry(next);
      setPendingPrompt(null);
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
    setPaused((p) => (p.short || p.offer ? { short: false, offer: false } : p));
  }, []);
  const onCaret = useCallback((a: Anchor | null) => {
    caretRef.current = a;
  }, []);

  const blocksKey = entry ? entry.blocks.map((b) => b.text).join('\u0001') : '';

  // Telemetry: recompute 300 ms after typing stops. Crisis signposting runs on
  // the same pass, at every level, and is never stored.
  useEffect(() => {
    if (!entry) return;
    const t = setTimeout(() => {
      const next = computeTelemetry(entry.blocks, thresholds);
      setTelemetry(next);
      setTrace((tr) => [...tr, { iTalk: next.iTalkDensity, cog: next.cogProcDensity, neg: next.negAffectDensity, fusion: next.fusionScore, gran: next.granularityIndex }].slice(-TRACE_LENGTH));
      setRumination((r) => nextRuminationState(r.active, r.clearPasses, next.ruminationFlag));
      setCrisis(mentionsCrisis(blocksToText(entry.blocks)));
    }, TELEMETRY_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocksKey, thresholds]);

  const persistNow = useCallback(
    async (e: Entry): Promise<void> => {
      const toSave: Entry = { ...e, activeSeconds: secondsRef.current, prompt: e.prompt ?? shownPromptRef.current ?? null };
      await saveDraft(toSave);
      const words = countWords(blocksToText(e.blocks));
      if (words > 0) await saveTelemetry(e, computeTelemetry(e.blocks, thresholds));
      dirtyRef.current = false;
      if (toSave.prompt && !e.prompt) setEntry((cur) => (cur && cur.id === e.id ? { ...cur, prompt: toSave.prompt } : cur));
      if (!persistedRef.current) {
        persistedRef.current = true;
        loadedIdRef.current = e.id;
        openEntry(e.id);
      }
    },
    [openEntry, thresholds],
  );

  // Autosave 800 ms after the last change. Empty new entries are never stored.
  useEffect(() => {
    if (!entry || !dirtyRef.current) return;
    const hasContent = entry.title.trim().length > 0 || entry.blocks.some((b) => b.text.trim().length > 0) || !!entry.exercise;
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

  // Pauses: "Go deeper" after a long one; one-tap and live offers after short ones.
  useEffect(() => {
    const t = setInterval(() => {
      const quiet = Date.now() - lastInputRef.current;
      const shouldIdle = quiet > IDLE_MS && telemetry.wordCount >= IDLE_MIN_WORDS && !stream.active;
      setIdle((prev) => (prev !== shouldIdle ? shouldIdle : prev));
      const short = quiet > SUGGEST_PAUSE_MS;
      const offer = quiet > OFFER_PAUSE_MS;
      setPaused((p) => (p.short !== short || p.offer !== offer ? { short, offer } : p));
    }, 400);
    return () => clearInterval(t);
  }, [telemetry.wordCount, stream.active]);

  const ensurePersisted = useCallback(async (): Promise<string> => {
    const e = entryRef.current;
    if (!e) throw new Error('no entry');
    if (!persistedRef.current || dirtyRef.current) await persistNow(e);
    return e.id;
  }, [persistNow]);

  // ---------- guidance: the starter prompt and offers ----------
  const entryId = entry?.id ?? '';
  const isFresh = !!entry && entry.status === 'draft' && !entry.prompt && entry.blocks.every((b) => !b.text.trim()) && !entry.title.trim();
  useEffect(() => {
    if (!entry || blank) {
      setGuidanceCtx(null);
      return;
    }
    let cancelled = false;
    void loadGuidanceContext(settings).then((ctx) => {
      if (cancelled) return;
      setGuidanceCtx(ctx);
      if (isFresh && !pendingPrompt) setStarter({ pick: pickStarter(ctx), index: 0 });
    });
    return () => {
      cancelled = true;
    };
    // Recomputed per entry and when the level or goals change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, level, settings.guidance.goals, settings.guidance.avoidTopics, blank]);

  // A prompt handed over from elsewhere (the weekly review, a note) starts a fresh entry.
  // Taking the prompt clears it, so a later visit to the journal doesn't start another entry.
  useEffect(() => {
    if (!newEntryNonce) return;
    const p = takePendingPrompt();
    if (!p) return;
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    newEntryNow({ id: p.id, text: p.text, reason: p.reason, level });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newEntryNonce]);

  const exercise: EntryExercise | null = entry?.exercise ?? null;
  const exerciseActive = !!exercise && !exercise.finishedAt;
  const live = useMemo(() => {
    if (!guided || !entry || entry.status !== 'draft' || !paused.offer) return null;
    return liveOffer({ guidance: settings.guidance, telemetry, circling: rumination.active, blocks: entry.blocks, exercise, dismissed: dismissedOffers });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guided, entryId, entry?.status, paused.offer, telemetry, rumination.active, exercise, dismissedOffers, settings.guidance]);
  const starterOffer = starter?.pick.offer && !dismissedOffers.has(starter.pick.offer.technique) && !exercise && techniqueEnabled(starter.pick.offer.technique, settings.guidance) ? starter.pick.offer : null;
  const offer: TechniqueOffer | null = exercise ? null : (live ?? starterOffer);

  // ---------- co-pilot ----------
  const requestCopilot = useCallback(
    async (requested: CopilotMode, lens: LensId | null = null) => {
      const e = entryRef.current;
      if (!e || abortRef.current) return;
      // The rumination guard: while the writing circles, never an immersed "why" question.
      let mode = requested;
      if (mode === 'socratic' && rumination.active) {
        mode = guardModeRef.current === 'concrete' ? 'distancing' : 'concrete';
        guardModeRef.current = mode;
      }
      if (countWords(blocksToText(e.blocks)) < (mode === 'lens' ? 15 : 8)) return;
      const entryIdNow = await ensurePersisted();
      let anchorId: string | null = null;
      if (mode === 'socratic' || mode === 'distancing' || mode === 'concrete') {
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
      if (!blank) setCopilotCollapsed(false);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStream({ active: true, text: '', mode, lens });
      try {
        const running = runCopilot({
          entryId: entryIdNow,
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
    [ensurePersisted, settings, thresholds, updateEntry, rumination.active, blank],
  );

  const cancelStream = useCallback(() => abortRef.current?.abort(), []);

  const runFinish = useCallback(async () => {
    const e = entryRef.current;
    if (!e || finish.running) return;
    if (countWords(blocksToText(e.blocks)) === 0) return;
    abortRef.current?.abort();
    setCopilotTab('synthesis');
    if (!blank) setCopilotCollapsed(false);
    setFinish({ running: true, steps: COMPLETION_STEPS.map((label) => ({ label, done: false })) });
    // Drop empty paragraphs that carry no question.
    const turns = await getDB().copilotTurns.where('entryId').equals(e.id).toArray();
    const anchoredIds = new Set(turns.map((t) => t.anchor?.blockId).filter(Boolean) as string[]);
    const cleaned = e.blocks.filter((b, i) => b.text.trim() || anchoredIds.has(b.id) || i === 0);
    const toFinish: Entry = { ...e, blocks: cleaned.length ? cleaned : e.blocks, activeSeconds: secondsRef.current, prompt: e.prompt ?? shownPromptRef.current ?? null };
    try {
      await completeEntry(toFinish, (done) => setFinish((f) => ({ ...f, steps: f.steps.map((s, i) => (i <= done ? { ...s, done: true } : s)) })));
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
  }, [activeEntryId, finish.running, openEntry, blank]);

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
      if (narrow) setRailCollapsed(true);
    },
    [flushPending, openEntry, narrow],
  );

  const newEntryNow = useCallback(
    (prompt: EntryPrompt | null = null) => {
      void flushPending();
      loadedIdRef.current = null;
      openEntry(null);
      // openEntry(null) may not change state if already null; force a fresh entry.
      const fresh = newEntry();
      persistedRef.current = false;
      loadedIdRef.current = fresh.id;
      resetForEntry(fresh);
      setPendingPrompt(prompt);
      setTrace([]);
      setCopilotTab('inquiry');
      setFocusRequest({ blockId: fresh.blocks[0].id, offset: 0, nonce: Date.now() });
    },
    [flushPending, openEntry, resetForEntry],
  );

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

  /** Adds a paragraph after the last one with text (an empty one if `text` is empty) and returns its id. */
  const appendBlock = useCallback(
    (text: string): string => {
      const e = entryRef.current;
      if (!e) return '';
      const blocks = e.blocks.slice();
      let idx = blocks.length - 1;
      while (idx > 0 && !blocks[idx].text.trim()) idx--;
      const fresh: Block = { id: uid('b'), text };
      // Reuse a lone empty first paragraph rather than leaving it blank above.
      if (blocks.length === 1 && !blocks[0].text.trim()) {
        blocks[0] = { ...blocks[0], text };
        updateEntry({ blocks });
        return blocks[0].id;
      }
      blocks.splice(idx + 1, 0, fresh);
      updateEntry({ blocks });
      return fresh.id;
    },
    [updateEntry],
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

  // ---------- exercises ----------
  const setExercise = useCallback(
    async (patch: Partial<EntryExercise> | EntryExercise | null) => {
      const e = entryRef.current;
      if (!e) return;
      const next = patch === null ? null : 'technique' in patch && 'startedAt' in patch ? (patch as EntryExercise) : e.exercise ? { ...e.exercise, ...patch } : null;
      const updated = { ...e, exercise: next };
      setEntry(updated);
      dirtyRef.current = true;
      await persistNow(updated);
    },
    [persistNow],
  );

  const startTechnique = useCallback(
    async (o: TechniqueOffer, switchedFrom: TechniqueId | null = null) => {
      const t = getTechnique(o.technique);
      if (t.guarded && rumination.active) return;
      await ensurePersisted();
      const ex: EntryExercise = { technique: o.technique, step: 0, startedAt: new Date().toISOString(), finishedAt: null, exitedAt: null, session: o.session ?? 1, switchedFrom };
      await setExercise(ex);
      if (!blank) setCopilotCollapsed(narrow);
    },
    [ensurePersisted, setExercise, rumination.active, blank, narrow],
  );

  const insertStepPrompt = useCallback(
    async (step: number, text: string) => {
      const e = entryRef.current;
      if (!e?.exercise) return;
      const t = getTechnique(e.exercise.technique);
      const blockId = appendBlock('');
      const id = await ensurePersisted();
      const turn: CopilotTurn = {
        id: uid('t'),
        entryId: id,
        pairId: uid('p'),
        mode: 'exercise',
        lens: null,
        role: 'assistant',
        text,
        anchor: { blockId, offset: 0 },
        provider: 'heuristic',
        model: 'technique-v1',
        fallbackUsed: false,
        incomplete: false,
        createdAt: new Date().toISOString(),
        technique: t.id,
        step,
      };
      await getDB().copilotTurns.add(turn);
      setFocusRequest({ blockId, offset: 0, nonce: Date.now() });
    },
    [appendBlock, ensurePersisted],
  );

  // ---------- one-tap ----------
  const oneTapOn = !blank && settings.planner.oneTap && entry?.status === 'draft';
  useEffect(() => {
    if (!oneTapOn || !entry || !paused.short) return;
    const skip = new Set(entry.dismissedSuggestions ?? []);
    const found = findTaskSuggestions(entry.blocks).filter((s) => !skip.has(s.key) && !skip.has(`added:${s.key}`) && !added[s.key]);
    const map: Record<string, TaskSuggestion[]> = {};
    for (const s of found) (map[s.blockId] ??= []).push(s);
    setSuggestions(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oneTapOn, paused.short, blocksKey, entry?.dismissedSuggestions, added]);

  const oneTap: OneTapProps | null = useMemo(() => {
    if (!oneTapOn) return null;
    return {
      suggestions,
      added,
      onAdd: async (s, keepDate) => {
        const id = await ensurePersisted();
        const w = keepDate ? s.when : null;
        const task = await addTask({
          title: keepDate || !s.when ? s.title : `${s.title} ${s.when.text}`.trim(),
          dueDay: w?.day ?? (w?.repeat ? new Date().toISOString().slice(0, 10) : null),
          dueTime: w?.time ?? null,
          repeat: w?.repeat ?? null,
          entryId: id,
          blockId: s.blockId,
          sourceText: s.sentence,
        });
        setAdded((a) => ({ ...a, [s.key]: { key: s.key, label: addedLabel(s, keepDate), taskId: task.id } }));
        const e = entryRef.current;
        if (e) updateEntry({ dismissedSuggestions: [...(e.dismissedSuggestions ?? []), `added:${s.key}`] });
      },
      onDismiss: (s) => {
        const e = entryRef.current;
        if (e) updateEntry({ dismissedSuggestions: [...(e.dismissedSuggestions ?? []), s.key] });
        setSuggestions((m) => ({ ...m, [s.blockId]: (m[s.blockId] ?? []).filter((x) => x.key !== s.key) }));
      },
      onUndo: async (note) => {
        await deleteTask(note.taskId);
        setAdded((a) => {
          const next = { ...a };
          delete next[note.key];
          return next;
        });
        const e = entryRef.current;
        if (e) updateEntry({ dismissedSuggestions: (e.dismissedSuggestions ?? []).filter((k) => k !== `added:${note.key}`) });
      },
      onOpen: (note) => {
        void flushPending().then(() => openTask(note.taskId));
      },
    };
  }, [oneTapOn, suggestions, added, ensurePersisted, updateEntry, flushPending, openTask]);

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
        void h.requestCopilot('socratic');
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
      else if (a.kind === 'deeper') void requestCopilot('socratic');
      else if (a.kind === 'stepback') void requestCopilot('distancing');
      else if (a.kind === 'finish') void runFinish();
      else if (a.kind === 'forecast') setShowForecast(true);
    },
    [requestCopilot, runFinish],
  );

  const changeLevel = useCallback(
    async (next: GuidanceLevel) => {
      const saved = await saveSettings({ guidance: { level: next } });
      setSettings(saved);
      if (next === 'open') setCopilotCollapsed(true);
      if (next === 'guided' || next === 'deep') {
        if (!narrow) setCopilotCollapsed(false);
        if (!saved.guidance.setupDone) setSetupOpen(true);
      }
    },
    [setSettings, narrow],
  );

  // ---------- live data for the side panes ----------
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
  const checks = useLiveQuery(() => (entryId ? getDB().feelingChecks.where('entryId').equals(entryId).toArray() : []), [entryId]) ?? [];
  const worries = useLiveQuery(() => getDB().notes.toArray(), []) ?? [];

  // "Last time you tried ..." asks once, on a new entry within a few days.
  const nextCheck =
    useLiveQuery(async () => {
      if (!guidanceCtx || !isFresh || !settings.guidance.feelingCheck) return null;
      const prev = guidanceCtx.recent.find((r) => r.id !== entryId && r.exercise?.finishedAt && !r.exercise.exitedAt && !r.exercise.switchedFrom);
      if (!prev?.exercise) return null;
      const daysAgo = (Date.now() - new Date(prev.exercise.finishedAt!).getTime()) / 86400000;
      if (daysAgo > 3 || daysAgo < 0.25) return null;
      const prevChecks = await getDB().feelingChecks.where('entryId').equals(prev.id).toArray();
      if (!prevChecks.some((c) => c.phase === 'before') || prevChecks.some((c) => c.phase === 'next')) return null;
      return { entryId: prev.id, technique: prev.exercise.technique };
    }, [guidanceCtx, isFresh, entryId, settings.guidance.feelingCheck]) ?? null;

  const anchored = useMemo(() => {
    const map: Record<string, AnchoredQuestion> = {};
    for (const t of turns) {
      if (!t.anchor) continue;
      if (t.mode === 'socratic' || t.mode === 'distancing' || t.mode === 'concrete') map[t.anchor.blockId] = { text: t.text, mode: t.mode, streaming: false };
      if (t.mode === 'exercise' && t.technique) {
        const tech = getTechnique(t.technique);
        map[t.anchor.blockId] = { text: t.text, mode: 'exercise', streaming: false, label: `${tech.name}, step ${(t.step ?? 0) + 1} of ${tech.steps.length}` };
      }
    }
    if (pendingAnchor && stream.active) {
      map[pendingAnchor] = { text: stream.text, mode: stream.mode === 'distancing' || stream.mode === 'concrete' ? stream.mode : 'socratic', streaming: true };
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
  const showEventChip = !blank && !eventChipDismissed && forecasts.length === 0 && entry.status === 'draft' && words > 10 && detectFutureEvent(blocksToText(entry.blocks));
  const prompts = starter?.pick.prompts ?? [];
  const coming = guided && guidanceCtx && entry.status === 'draft' ? comingUpForJournal(guidanceCtx) : [];
  const firstCoarse = telemetry.coarseLabels[0] ?? null;

  return (
    <div className="flex h-full">
      {railCollapsed ? (
        <div className="hidden w-10 shrink-0 flex-col items-center border-r border-ink-800 bg-ink-950 pt-4 sm:flex">
          <button type="button" onClick={() => setRailCollapsed(false)} title="Show entries" className="rounded p-2 text-paper-500 hover:bg-ink-900 hover:text-paper-100">
            <ChevronsRight size={15} />
          </button>
        </div>
      ) : (
        <>
          {narrow && <button type="button" aria-label="Close entries" className="fixed inset-0 z-30 bg-black/50" onClick={() => setRailCollapsed(true)} />}
          <div className={narrow ? 'fixed inset-y-0 left-0 z-40 flex max-w-[85vw] shadow-[0_0_60px_rgba(0,0,0,0.6)]' : 'flex'}>
            <EntryRail
              activeId={entry.id}
              onOpen={(id) => void openFromRail(id)}
              onNew={() => {
                newEntryNow();
                if (narrow) setRailCollapsed(true);
              }}
              onCollapse={() => setRailCollapsed(true)}
            />
          </div>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-ink-800 px-3 sm:gap-3 sm:px-6">
              {narrow && railCollapsed && (
                <button type="button" onClick={() => setRailCollapsed(false)} title="Show entries" aria-label="Show entries" className="rounded p-1.5 text-paper-500 hover:bg-ink-900 hover:text-paper-100">
                  <ChevronsRight size={15} />
                </button>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-paper-300">
                  {formatDay(entry.localDay, { weekday: 'long', day: 'numeric', month: 'long' })}
                  <span className="text-paper-500">{entry.status === 'complete' ? ', finished' : persistedRef.current ? ', saved as draft' : ''}</span>
                </p>
              </div>
              <span className="nr-num hidden text-[12.5px] text-paper-500 sm:inline">{words} words</span>
              <span className="hidden sm:inline">
                <SessionTimer lastInputRef={lastInputRef} secondsRef={secondsRef} frozen={finish.running} />
              </span>
              <div className="mx-1 hidden h-5 w-px bg-ink-800 sm:block" />
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
                  className={`hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] disabled:cursor-not-allowed disabled:opacity-40 sm:inline-flex ${
                    dictation.listening ? 'bg-rose-400/15 text-rose-300' : 'text-paper-300 hover:bg-ink-900'
                  }`}
                >
                  {dictation.listening ? <MicOff size={14} /> : <Mic size={14} />}
                  {dictation.listening ? 'Stop' : 'Dictate'}
                </button>
              )}
              {narrow && !blank && copilotCollapsed && (
                <button type="button" onClick={() => setCopilotCollapsed(false)} aria-label="Open co-pilot" title="Co-pilot" className="inline-flex items-center rounded-lg px-2 py-1.5 text-paper-300 hover:bg-ink-900">
                  <MessageCircleQuestion size={15} />
                </button>
              )}
              <button type="button" onClick={() => setShowForecast((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-paper-300 hover:bg-ink-900 sm:px-2.5">
                <CalendarClock size={14} /> <span className="hidden sm:inline">Forecast</span>
              </button>
              <button type="button" onClick={() => setShowPalette(true)} title="Mental model lenses (Ctrl+K)" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-paper-300 hover:bg-ink-900 sm:px-2.5">
                <Layers size={14} /> <span className="hidden sm:inline">Lenses</span>
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
              {!blank && <CalibrationBanner />}
              <div className="mx-auto w-full max-w-[720px] px-4 pb-48 pt-6 sm:px-10 sm:pt-8">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
                  <GuidanceSlider level={level} onChange={(l) => void changeLevel(l)} />
                </div>

                {crisis && !crisisHidden && <CrisisCard onHide={() => setCrisisHidden(true)} onMore={() => setHelpOpen(true)} />}

                {coming.length > 0 && <ComingUpStrip items={coming} onOpen={() => setTab('planner')} />}

                {!blank && entry.status === 'draft' && (
                  <PromptCard
                    prompt={shownPrompt}
                    canCycle={!entry.prompt && !pendingPrompt && prompts.length > 1}
                    onAnother={() => setStarter((s) => (s ? { ...s, index: (s.index + 1) % s.pick.prompts.length } : s))}
                    onHide={() => {
                      setPromptHidden(true);
                      setPendingPrompt(null);
                      if (entry.prompt) updateEntry({ prompt: null });
                    }}
                    onSetup={guided && !settings.guidance.setupDone ? () => setSetupOpen(true) : undefined}
                  >
                    {shownPrompt?.id === 'tomorrow-list' && <TomorrowList />}
                    {nextCheck && !nextCheckDone && (
                      <NextTimeCheck
                        techniqueName={getTechnique(nextCheck.technique).name}
                        onPick={(value) => {
                          void recordFeeling({ entryId: nextCheck.entryId, technique: nextCheck.technique, phase: 'next', value });
                          setNextCheckDone(true);
                        }}
                        onSkip={() => setNextCheckDone(true)}
                      />
                    )}
                    {offer && !exerciseActive && (
                      <OfferChip offer={offer} onStart={(o) => void startTechnique(o)} onDismiss={(id) => setDismissedOffers((s) => new Set([...s, id]))} />
                    )}
                  </PromptCard>
                )}
                {entry.status === 'complete' && entry.prompt && (
                  <p className="mb-5 border-l-2 border-ink-700 pl-4 font-serif text-[1rem] italic leading-7 text-paper-300" data-testid="entry-prompt">
                    {entry.prompt.text}
                  </p>
                )}

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

                <BlockEditor
                  blocks={entry.blocks}
                  onChange={onBlocks}
                  onCaret={onCaret}
                  onActivity={onActivity}
                  focusRequest={focusRequest}
                  anchored={anchored}
                  showMarks={!blank}
                  oneTap={oneTap}
                  placeholder={blank ? 'Just you and the page.' : undefined}
                />

                {(dictation.interim || dictation.error) && (
                  <p className={`mt-2 text-[13px] ${dictation.error ? 'text-rose-300' : 'italic text-paper-500'}`}>{dictation.error ?? dictation.interim}</p>
                )}
                {guided && idle && !stream.active && entry.status === 'draft' && !exerciseActive && (
                  <p className="nr-rise mt-4 text-[13px] text-paper-500">
                    Pausing is fine. When you want a question, press <kbd className="text-paper-300">Ctrl Enter</kbd>.
                  </p>
                )}

                {exercise && entry.status === 'draft' && (
                  <div className="sticky bottom-4 z-10 mt-6">
                    <ExerciseRunner
                      entryId={entry.id}
                      exercise={exercise}
                      checks={checks}
                      circling={rumination.active}
                      values={values}
                      worries={worries}
                      feelingCheckOn={settings.guidance.feelingCheck && !exercise.switchedFrom}
                      firstCoarse={firstCoarse}
                      hasStepPrompt={(step) => turns.some((t) => t.mode === 'exercise' && t.technique === exercise.technique && t.step === step)}
                      onInsertStepPrompt={insertStepPrompt}
                      onInsertText={(text) => {
                        appendBlock(text);
                        const blankId = appendBlock('');
                        setFocusRequest({ blockId: blankId, offset: 0, nonce: Date.now() });
                      }}
                      onUpdate={(patch) => setExercise(patch)}
                      onOpenName={() => {
                        setCopilotTab('name');
                        setCopilotCollapsed(false);
                      }}
                      onStepBack={() => void requestCopilot('distancing')}
                      onConcrete={() => void requestCopilot('concrete')}
                      onSwitch={(id) => void startTechnique({ technique: id, reason: '' }, exercise.technique)}
                      onHelp={() => setHelpOpen(true)}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {!blank && (
            <CopilotPane
              collapsed={copilotCollapsed}
              onToggle={() => setCopilotCollapsed((v) => !v)}
              tab={copilotTab}
              setTab={setCopilotTab}
              entry={{ ...entry, wordCount: words }}
              turns={turns}
              stream={stream}
              ruminationActive={rumination.active}
              suggestDeeper={guided && idle}
              telemetry={telemetry}
              synthesis={synthesis}
              values={values}
              alignments={alignments}
              mentions={mentions}
              finish={finish}
              onGoDeeper={() => void requestCopilot('socratic')}
              onStepBack={() => void requestCopilot('distancing')}
              onConcrete={() => void requestCopilot('concrete')}
              onLens={(l) => void requestCopilot('lens', l)}
              onCancel={cancelStream}
              onFinish={() => void runFinish()}
              onReplaceCoarse={replaceCoarse}
              onInsertTerm={(t) => insertAtCaret(t)}
              onConfirmMention={confirmMention}
              onRemoveMention={removeMention}
              overlay={narrow}
            />
          )}

          {showForecast && (
            <ForecastPanel
              entryId={persistedRef.current ? entry.id : null}
              ensureEntry={ensurePersisted}
              onClose={() => setShowForecast(false)}
              onSaved={() => setShowForecast(false)}
            />
          )}
        </div>

        {!blank && (
          <TelemetryBar
            telemetry={telemetry}
            trace={trace}
            thresholds={thresholds}
            ruminationActive={stepBackActive}
            suggestionsOff={!guided}
            onDismiss={() => setStepBackDismissed(true)}
            onStepBack={() => void requestCopilot('distancing')}
            busy={stream.active}
          />
        )}
      </div>

      {showPalette && <LensPicker onPick={onPalette} onClose={() => setShowPalette(false)} />}
      {setupOpen && <GoalsSetup onClose={() => setSetupOpen(false)} />}
    </div>
  );
}
