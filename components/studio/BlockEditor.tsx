'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { familiesForCoarse, findCoarseLabels, findFusionSpans, patternName, type FusionSpan, type LabelSpan } from '@/lib/psych-engine';
import type { Anchor, Block } from '@/lib/types';
import { uid } from '@/lib/util';

export interface FocusRequest {
  blockId: string;
  offset: number;
  nonce: number;
}

export interface AnchoredQuestion {
  text: string;
  mode: 'socratic' | 'distancing';
  streaming: boolean;
}

interface Props {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  onCaret: (anchor: Anchor | null) => void;
  onActivity: () => void;
  focusRequest: FocusRequest | null;
  anchored: Record<string, AnchoredQuestion>;
}

type Mark =
  | { kind: 'fused'; start: number; end: number; span: FusionSpan }
  | { kind: 'defused'; start: number; end: number; span: FusionSpan }
  | { kind: 'coarse'; start: number; end: number; label: LabelSpan }
  | { kind: 'tag'; start: number; end: number };

function marksFor(block: Block): Mark[] {
  const marks: Mark[] = [];
  for (const s of findFusionSpans([block])) marks.push({ kind: s.defused ? 'defused' : 'fused', start: s.start, end: s.end, span: s });
  for (const l of findCoarseLabels([block])) {
    if (marks.some((m) => l.start < m.end && l.end > m.start)) continue;
    marks.push({ kind: 'coarse', start: l.start, end: l.end, label: l });
  }
  const tagRe = /(^|\s)([@#$][A-Za-z][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(block.text)) !== null) {
    const start = m.index + m[1].length;
    const end = start + m[2].length;
    if (marks.some((x) => start < x.end && end > x.start)) continue;
    marks.push({ kind: 'tag', start, end });
  }
  return marks.sort((a, b) => a.start - b.start);
}

const MARK_CLASS: Record<Mark['kind'], string> = {
  fused: 'nr-mark-fused',
  defused: 'nr-mark-defused',
  coarse: 'nr-mark-coarse',
  tag: 'nr-mark-tag',
};

const LOWERCASE_STARTERS = new Set(['everyone', 'everybody', 'everything', 'nothing', 'nobody', 'no', 'they', 'he', 'she', 'people', 'it', 'this', 'my', 'things', 'the', 'all', 'it\'s', 'life']);

interface BlockRowProps {
  block: Block;
  index: number;
  placeholder: string;
  question?: AnchoredQuestion;
  registerRef: (id: string, el: HTMLTextAreaElement | null) => void;
  registerBackdrop: (id: string, el: HTMLDivElement | null) => void;
  onText: (id: string, text: string) => void;
  onKey: (e: React.KeyboardEvent<HTMLTextAreaElement>, block: Block, index: number) => void;
  onCaretMove: (id: string, el: HTMLTextAreaElement) => void;
  onHoverMove: (id: string, e: React.MouseEvent<HTMLTextAreaElement>) => void;
  onHoverLeave: () => void;
  onPasteLines: (id: string, el: HTMLTextAreaElement, text: string) => void;
}

const BlockRow = memo(function BlockRow(props: BlockRowProps) {
  const { block, placeholder, question, registerRef, registerBackdrop, onText, onKey, onCaretMove, onHoverMove, onHoverLeave, onPasteLines, index } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const marks = useMemo(() => marksFor(block), [block]);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(resize, [block.text, resize]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(resize);
    ro.observe(el.parentElement ?? el);
    return () => ro.disconnect();
  }, [resize]);

  const segments: React.ReactNode[] = [];
  let cursor = 0;
  marks.forEach((m, i) => {
    if (m.start > cursor) segments.push(block.text.slice(cursor, m.start));
    segments.push(
      <span key={i} className={MARK_CLASS[m.kind]} data-mark={i} data-kind={m.kind}>
        {block.text.slice(m.start, m.end)}
      </span>,
    );
    cursor = m.end;
  });
  if (cursor < block.text.length) segments.push(block.text.slice(cursor));

  return (
    <div className="group/block">
      {question && (
        <div className="nr-rise mb-2 mt-5 border-l-2 border-ember-500/70 pl-4" data-anchored-question>
          <p className="text-[12px] text-paper-500">{question.mode === 'distancing' ? 'A step back' : 'A question'}</p>
          <p className={`mt-0.5 font-serif text-[1.02rem] italic leading-7 text-paper-100 ${question.streaming ? 'nr-caret' : ''}`}>{question.text}</p>
        </div>
      )}
      <div className="nr-block mb-5">
        <div className="nr-backdrop" aria-hidden ref={(el) => registerBackdrop(block.id, el)}>
          {segments}
          {'​'}
        </div>
        <textarea
          ref={(el) => {
            ref.current = el;
            registerRef(block.id, el);
          }}
          rows={1}
          value={block.text}
          spellCheck
          aria-label={`Paragraph ${index + 1}`}
          placeholder={placeholder}
          onChange={(e) => onText(block.id, e.target.value)}
          onKeyDown={(e) => onKey(e, block, index)}
          onSelect={(e) => onCaretMove(block.id, e.currentTarget)}
          onFocus={(e) => onCaretMove(block.id, e.currentTarget)}
          onMouseMove={(e) => onHoverMove(block.id, e)}
          onMouseLeave={onHoverLeave}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text/plain');
            if (/\n/.test(text)) {
              e.preventDefault();
              onPasteLines(block.id, e.currentTarget, text);
            }
          }}
        />
      </div>
    </div>
  );
});

interface PopoverState {
  blockId: string;
  mark: Mark;
  top: number;
  left: number;
  via: 'hover' | 'caret';
}

export default function BlockEditor({ blocks, onChange, onCaret, onActivity, focusRequest, anchored }: Props) {
  const refs = useRef(new Map<string, HTMLTextAreaElement>());
  const backdrops = useRef(new Map<string, HTMLDivElement>());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFocus = useRef<{ id: string; offset: number } | null>(null);

  const registerRef = useCallback((id: string, el: HTMLTextAreaElement | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  }, []);
  const registerBackdrop = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) backdrops.current.set(id, el);
    else backdrops.current.delete(id);
  }, []);

  const focusBlock = useCallback((id: string, offset: number) => {
    pendingFocus.current = { id, offset };
    requestAnimationFrame(() => {
      const target = pendingFocus.current;
      if (!target) return;
      const el = refs.current.get(target.id);
      if (!el) return;
      el.focus();
      const pos = Math.min(target.offset, el.value.length);
      el.setSelectionRange(pos, pos);
      pendingFocus.current = null;
    });
  }, []);

  useEffect(() => {
    if (focusRequest) focusBlock(focusRequest.blockId, focusRequest.offset);
  }, [focusRequest, focusBlock]);

  const commit = useCallback(
    (next: Block[]) => {
      onChange(next);
      onActivity();
    },
    [onChange, onActivity],
  );

  const onText = useCallback(
    (id: string, text: string) => {
      const current = blocksRef.current;
      const idx = current.findIndex((b) => b.id === id);
      if (idx < 0) return;
      if (text.includes('\n')) {
        // A newline slipped in (IME, autocorrect): split into blocks.
        const parts = text.split('\n');
        const created = parts.slice(1).map((p) => ({ id: uid('b'), text: p }));
        const next = [...current.slice(0, idx), { ...current[idx], text: parts[0] }, ...created, ...current.slice(idx + 1)];
        commit(next);
        const last = created[created.length - 1];
        if (last) focusBlock(last.id, 0);
        return;
      }
      const next = current.slice();
      next[idx] = { ...current[idx], text };
      commit(next);
      setPopover((p) => (p?.via === 'hover' ? null : p));
    },
    [commit, focusBlock],
  );

  const onPasteLines = useCallback(
    (id: string, el: HTMLTextAreaElement, pasted: string) => {
      const current = blocksRef.current;
      const idx = current.findIndex((b) => b.id === id);
      if (idx < 0) return;
      const { selectionStart, selectionEnd, value } = el;
      const before = value.slice(0, selectionStart);
      const after = value.slice(selectionEnd);
      const lines = pasted.replace(/\r\n/g, '\n').split(/\n+/).map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return;
      const first = { ...current[idx], text: before + lines[0] };
      const middle = lines.slice(1).map((l) => ({ id: uid('b'), text: l }));
      const lastBlock = middle.length ? middle[middle.length - 1] : first;
      const caret = lastBlock.text.length;
      lastBlock.text = lastBlock.text + after;
      commit([...current.slice(0, idx), first, ...middle, ...current.slice(idx + 1)]);
      focusBlock(lastBlock.id, caret);
    },
    [commit, focusBlock],
  );

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>, block: Block, index: number) => {
      if (e.nativeEvent.isComposing) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return; // global shortcuts handle these
      const el = e.currentTarget;
      const { selectionStart, selectionEnd, value } = el;
      const collapsed = selectionStart === selectionEnd;
      const current = blocksRef.current;

      if (e.key === 'Escape') {
        setPopover(null);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const nb: Block = { id: uid('b'), text: value.slice(selectionEnd) };
        const next = current.slice();
        next[index] = { ...block, text: value.slice(0, selectionStart) };
        next.splice(index + 1, 0, nb);
        commit(next);
        focusBlock(nb.id, 0);
        return;
      }
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault(); // paragraphs are blocks; no soft line breaks
        return;
      }
      if (e.key === 'Backspace' && collapsed && selectionStart === 0 && index > 0) {
        e.preventDefault();
        const prev = current[index - 1];
        const next = current.slice();
        next[index - 1] = { ...prev, text: prev.text + value };
        next.splice(index, 1);
        commit(next);
        focusBlock(prev.id, prev.text.length);
        return;
      }
      if (e.key === 'Delete' && collapsed && selectionStart === value.length && index < current.length - 1) {
        e.preventDefault();
        const nxt = current[index + 1];
        const next = current.slice();
        next[index] = { ...block, text: value + nxt.text };
        next.splice(index + 1, 1);
        commit(next);
        focusBlock(block.id, value.length);
        return;
      }
      if (e.key === 'ArrowUp' && collapsed && selectionStart === 0 && index > 0) {
        e.preventDefault();
        focusBlock(current[index - 1].id, current[index - 1].text.length);
        return;
      }
      if (e.key === 'ArrowDown' && collapsed && selectionStart === value.length && index < current.length - 1) {
        e.preventDefault();
        focusBlock(current[index + 1].id, 0);
      }
    },
    [commit, focusBlock],
  );

  const positionFor = useCallback((rect: DOMRect) => {
    const c = containerRef.current;
    if (!c) return { top: 0, left: 0 };
    const cr = c.getBoundingClientRect();
    const width = 340;
    const left = Math.max(8, Math.min(rect.left - cr.left, cr.width - width - 8));
    return { top: rect.bottom - cr.top + c.scrollTop + 8, left };
  }, []);

  const markAtPoint = useCallback((blockId: string, x: number, y: number): { mark: Mark; rect: DOMRect } | null => {
    const bd = backdrops.current.get(blockId);
    const block = blocksRef.current.find((b) => b.id === blockId);
    if (!bd || !block) return null;
    const marks = marksFor(block);
    const nodes = bd.querySelectorAll<HTMLSpanElement>('[data-mark]');
    for (const node of nodes) {
      const i = Number(node.dataset.mark);
      const m = marks[i];
      if (!m || m.kind === 'tag') continue;
      for (const r of node.getClientRects()) {
        if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 3 && y <= r.bottom + 3) return { mark: m, rect: r };
      }
    }
    return null;
  }, []);

  const onHoverMove = useCallback(
    (blockId: string, e: React.MouseEvent<HTMLTextAreaElement>) => {
      const hit = markAtPoint(blockId, e.clientX, e.clientY);
      if (hit) {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        setPopover((p) => {
          if (p && p.blockId === blockId && p.mark.start === hit.mark.start && p.mark.kind === hit.mark.kind) return p;
          return { blockId, mark: hit.mark, ...positionFor(hit.rect), via: 'hover' };
        });
      } else {
        setPopover((p) => {
          if (p?.via === 'hover') {
            if (hideTimer.current) clearTimeout(hideTimer.current);
            hideTimer.current = setTimeout(() => setPopover((q) => (q?.via === 'hover' ? null : q)), 260);
          }
          return p;
        });
      }
    },
    [markAtPoint, positionFor],
  );

  const onHoverLeave = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setPopover((p) => (p?.via === 'hover' ? null : p)), 260);
  }, []);

  // Keyboard path to the same card: the caret sitting inside a highlighted phrase.
  const onCaretMove = useCallback(
    (id: string, el: HTMLTextAreaElement) => {
      onCaret({ blockId: id, offset: el.selectionStart });
      const block = blocksRef.current.find((b) => b.id === id);
      if (!block || el.selectionStart !== el.selectionEnd) return;
      const pos = el.selectionStart;
      const m = marksFor(block).find((x) => x.kind !== 'tag' && pos > x.start && pos < x.end);
      if (!m) {
        setPopover((p) => (p?.via === 'caret' ? null : p));
        return;
      }
      const bd = backdrops.current.get(id);
      const node = bd?.querySelector<HTMLSpanElement>(`[data-mark][data-kind="${m.kind}"]`);
      const nodes = bd ? Array.from(bd.querySelectorAll<HTMLSpanElement>('[data-mark]')) : [];
      const exact = nodes.find((n) => {
        const mk = marksFor(block)[Number(n.dataset.mark)];
        return mk && mk.start === m.start;
      });
      const rects = (exact ?? node)?.getClientRects();
      const rect = rects && rects.length ? rects[rects.length - 1] : el.getBoundingClientRect();
      setPopover((p) => (p && p.blockId === id && p.mark.start === m.start ? p : { blockId: id, mark: m, ...positionFor(rect), via: 'caret' }));
    },
    [onCaret, positionFor],
  );

  const replaceRange = useCallback(
    (blockId: string, start: number, end: number, text: string, caretAfter = true) => {
      const current = blocksRef.current;
      const idx = current.findIndex((b) => b.id === blockId);
      if (idx < 0) return;
      const b = current[idx];
      const next = current.slice();
      next[idx] = { ...b, text: b.text.slice(0, start) + text + b.text.slice(end) };
      commit(next);
      setPopover(null);
      if (caretAfter) focusBlock(blockId, start + text.length);
    },
    [commit, focusBlock],
  );

  const defuse = useCallback(
    (blockId: string, span: FusionSpan) => {
      const block = blocksRef.current.find((b) => b.id === blockId);
      if (!block) return;
      const before = block.text.slice(0, span.start);
      const m = before.match(/.*[.!?]\s+/s);
      const sStart = m ? m[0].length : before.match(/^\s*/)![0].length;
      const firstWord = block.text.slice(sStart).match(/^[A-Za-z']+/)?.[0] ?? '';
      const lower = LOWERCASE_STARTERS.has(firstWord.toLowerCase());
      const prefix = "I'm noticing the thought that ";
      const restStart = lower ? sStart + 1 : sStart;
      const replacement = prefix + (lower ? firstWord.charAt(0).toLowerCase() : '');
      replaceRange(blockId, sStart, restStart, replacement, false);
      focusBlock(blockId, span.end + prefix.length);
    },
    [replaceRange, focusBlock],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopover(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div ref={containerRef} className="relative" onMouseLeave={onHoverLeave}>
      {blocks.map((block, index) => (
        <BlockRow
          key={block.id}
          block={block}
          index={index}
          placeholder={
            anchored[block.id]
              ? 'Write your answer'
              : index === 0 && blocks.length === 1
                ? 'Start anywhere. What is on your mind?'
                : ''
          }
          question={anchored[block.id]}
          registerRef={registerRef}
          registerBackdrop={registerBackdrop}
          onText={onText}
          onKey={onKey}
          onCaretMove={onCaretMove}
          onHoverMove={onHoverMove}
          onHoverLeave={onHoverLeave}
          onPasteLines={onPasteLines}
        />
      ))}

      {popover && (
        <div
          role="dialog"
          aria-label="Reframe suggestion"
          className="nr-rise absolute z-20 w-[340px] rounded-xl border border-ink-700 bg-ink-850 p-4 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)]"
          style={{ top: popover.top, left: popover.left }}
          onMouseEnter={() => hideTimer.current && clearTimeout(hideTimer.current)}
          onMouseLeave={onHoverLeave}
        >
          <button type="button" aria-label="Close" onClick={() => setPopover(null)} className="absolute right-2.5 top-2.5 rounded p-1 text-paper-500 hover:text-paper-100">
            <X size={14} />
          </button>
          {popover.mark.kind === 'fused' && (
            <>
              <p className="pr-6 text-[13px] font-medium text-ember-300">{patternName(popover.mark.span.pattern)}</p>
              <p className="mt-1 text-[13px] leading-5 text-paper-300">
                This phrase is written from inside the thought, as if it were simply true. Stepping back from it, without arguing with it, tends to loosen its grip.
              </p>
              <p className="mt-3 rounded-lg bg-ink-900 px-3 py-2 font-serif text-[0.95rem] italic leading-6 text-paper-100">{popover.mark.span.reframe}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => popover.mark.kind === 'fused' && defuse(popover.blockId, popover.mark.span)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-ember-400 px-3 py-1.5 text-[13px] font-medium text-ink-950 hover:bg-ember-300"
                >
                  <Sparkles size={13} /> Rewrite as a noticed thought
                </button>
                <button type="button" onClick={() => setPopover(null)} className="rounded-lg px-3 py-1.5 text-[13px] text-paper-300 hover:bg-ink-800">
                  Keep as is
                </button>
              </div>
            </>
          )}
          {popover.mark.kind === 'defused' && (
            <>
              <p className="pr-6 text-[13px] font-medium text-sage-300">Defused</p>
              <p className="mt-1 text-[13px] leading-5 text-paper-300">
                You are observing this thought rather than speaking from inside it. That distance is what the defusion score tracks.
              </p>
            </>
          )}
          {popover.mark.kind === 'coarse' && (
            <CoarseOptions
              word={popover.mark.label.word}
              onPick={(term) => popover.mark.kind === 'coarse' && replaceRange(popover.blockId, popover.mark.start, popover.mark.end, term)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function CoarseOptions({ word, onPick }: { word: string; onPick: (term: string) => void }) {
  const { primary } = familiesForCoarse(word);
  const terms = primary.flatMap((f) => f.terms.slice(0, 4)).slice(0, 9);
  return (
    <>
      <p className="pr-6 text-[13px] font-medium text-dusk-300">Name it more precisely</p>
      <p className="mt-1 text-[13px] leading-5 text-paper-300">
        &ldquo;{word}&rdquo; covers a lot of ground. Is it closer to one of these? Picking one replaces the word.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {terms.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onPick(t)}
            className="rounded-full border border-ink-700 px-2.5 py-1 text-[12.5px] text-paper-100 hover:border-dusk-400 hover:bg-ink-800"
          >
            {t}
          </button>
        ))}
      </div>
    </>
  );
}
