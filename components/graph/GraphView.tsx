'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, X } from 'lucide-react';
import { getDB } from '@/lib/db';
import { useUI } from '@/lib/store';
import { formatDay } from '@/lib/util';
import { KIND_STYLE, LegendShape, type Kind } from './kinds';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

type GraphHandle = {
  zoomToFit: (ms?: number, px?: number) => void;
  centerAt: (x?: number, y?: number, ms?: number) => void;
  zoom: (k?: number, ms?: number) => void;
  d3Force: (name: string) => { strength?: (n: number) => void; distance?: (n: number) => void } | undefined;
};

interface GNode {
  id: string;
  kind: Kind;
  label: string;
  weight: number;
  x?: number;
  y?: number;
}
interface GLink {
  source: string | GNode;
  target: string | GNode;
  kind: 'mention' | 'co';
  weight: number;
}

const idOf = (v: string | GNode) => (typeof v === 'string' ? v : v.id);

// Keyboard and screen-reader route into the canvas: find a node by name.
function GraphFinder({ nodes, onPick }: { nodes: GNode[]; onPick: (n: GNode) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const starts = (n: GNode) => (n.label.toLowerCase().startsWith(s) ? 0 : 1);
    return nodes
      .filter((n) => n.label.toLowerCase().includes(s))
      .sort((a, b) => starts(a) - starts(b) || b.weight - a.weight || a.label.localeCompare(b.label))
      .slice(0, 8);
  }, [nodes, q]);
  const pick = (n: GNode) => {
    onPick(n);
    setQ('');
    setOpen(false);
  };
  const expanded = open && matches.length > 0;
  return (
    <div className="absolute left-4 top-4 z-10 w-[270px]">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-paper-500" aria-hidden />
        <input
          role="combobox"
          aria-label="Find in graph"
          aria-expanded={expanded}
          aria-controls="graph-find-list"
          aria-autocomplete="list"
          aria-activedescendant={expanded ? `gf-${matches[active]?.id}` : undefined}
          placeholder="Find a person, theme or entry"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, matches.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && matches[active]) {
              e.preventDefault();
              pick(matches[active]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          className="w-full rounded-lg border border-ink-700 bg-ink-900/95 py-1.5 pl-8 pr-2 text-[13px] text-paper-50 placeholder:text-paper-500 focus:border-ember-400 focus:outline-none"
        />
      </div>
      {expanded && (
        <ul id="graph-find-list" role="listbox" aria-label="Matches" className="mt-1 overflow-hidden rounded-lg border border-ink-700 bg-ink-850 py-1 shadow-xl">
          {matches.map((n, i) => (
            <li
              key={n.id}
              id={`gf-${n.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(n);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] ${i === active ? 'bg-ink-800 text-paper-50' : 'text-paper-100'}`}
            >
              <LegendShape kind={n.kind} />
              <span className="truncate">{n.label}</span>
              <span className="ml-auto shrink-0 text-[11.5px] text-paper-500">{KIND_STYLE[n.kind].singular}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function GraphView({ hidden, showCo }: { hidden: Set<Kind>; showCo: boolean }) {
  const { openEntry } = useUI();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<GraphHandle | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    const db = getDB();
    const [nodes, mentions, edges, entries] = await Promise.all([db.nodes.toArray(), db.mentions.toArray(), db.edges.toArray(), db.entries.toArray()]);
    return { nodes, mentions, edges, entries };
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const graph = useMemo(() => {
    if (!data) return { nodes: [] as GNode[], links: [] as GLink[] };
    const entryIds = new Set(data.entries.filter((e) => e.wordCount > 0).map((e) => e.id));
    const usedNodes = new Set(data.mentions.filter((m) => entryIds.has(m.entryId)).map((m) => m.nodeId));
    const nodes: GNode[] = [];
    if (!hidden.has('entry')) {
      for (const e of data.entries) {
        if (!entryIds.has(e.id)) continue;
        nodes.push({ id: e.id, kind: 'entry', label: e.title || formatDay(e.localDay), weight: 1 });
      }
    }
    for (const n of data.nodes) {
      if (!usedNodes.has(n.id) || hidden.has(n.kind)) continue;
      nodes.push({ id: n.id, kind: n.kind, label: n.label, weight: n.mentionCount });
    }
    const present = new Set(nodes.map((n) => n.id));
    const links: GLink[] = [];
    for (const m of data.mentions) {
      if (present.has(m.entryId) && present.has(m.nodeId)) links.push({ source: m.entryId, target: m.nodeId, kind: 'mention', weight: 1 });
    }
    if (showCo) {
      for (const e of data.edges) {
        if (present.has(e.sourceId) && present.has(e.targetId)) links.push({ source: e.sourceId, target: e.targetId, kind: 'co', weight: e.weight });
      }
    }
    return { nodes, links };
  }, [data, hidden, showCo]);

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const l of graph.links) {
      const a = idOf(l.source);
      const b = idOf(l.target);
      if (!map.has(a)) map.set(a, new Set());
      if (!map.has(b)) map.set(b, new Set());
      map.get(a)!.add(b);
      map.get(b)!.add(a);
    }
    return map;
  }, [graph]);

  useEffect(() => {
    // The graph component mounts asynchronously; retry briefly until its ref exists.
    let tries = 0;
    const t = setInterval(() => {
      const fg = fgRef.current;
      if (fg || tries++ > 20) clearInterval(t);
      if (!fg) return;
      fg.d3Force('charge')?.strength?.(-320);
      fg.d3Force('link')?.distance?.(90);
    }, 50);
    return () => clearInterval(t);
  }, [graph]);

  const focus = hover ?? selected;
  const isLit = useCallback((id: string) => !focus || id === focus || neighbours.get(focus)?.has(id), [focus, neighbours]);

  const drawNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const s = KIND_STYLE[node.kind];
      const lit = isLit(node.id);
      // Sizes are in screen pixels, divided by zoom, so zooming spreads nodes
      // apart instead of inflating them over their labels.
      const px = 1 / scale;
      const r = (node.kind === 'entry' ? 5 : 5.5 + Math.min(5, Math.sqrt(node.weight) * 1.8)) * px;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      ctx.globalAlpha = lit ? 1 : 0.18;
      ctx.fillStyle = s.color;
      ctx.strokeStyle = s.color;
      ctx.beginPath();
      switch (s.shape) {
        case 'circle':
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'diamond':
          ctx.moveTo(x, y - r * 1.2);
          ctx.lineTo(x + r * 1.2, y);
          ctx.lineTo(x, y + r * 1.2);
          ctx.lineTo(x - r * 1.2, y);
          ctx.closePath();
          ctx.fill();
          break;
        case 'square':
          ctx.rect(x - r, y - r, r * 2, r * 2);
          ctx.fill();
          break;
        case 'triangle':
          ctx.moveTo(x, y - r * 1.2);
          ctx.lineTo(x + r * 1.15, y + r * 0.9);
          ctx.lineTo(x - r * 1.15, y + r * 0.9);
          ctx.closePath();
          ctx.fill();
          break;
        case 'ring':
          ctx.lineWidth = 2.5 * px;
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'entry':
          ctx.rect(x - r * 1.3, y - r, r * 2.6, r * 2);
          ctx.fill();
          break;
      }
      if (node.id === selected) {
        ctx.lineWidth = 2 * px;
        ctx.strokeStyle = '#e0aa4a';
        ctx.beginPath();
        ctx.arc(x, y, r + 5 * px, 0, Math.PI * 2);
        ctx.stroke();
      }
      const fontSize = (node.kind === 'entry' ? 11 : 12) * px;
      ctx.font = `${node.kind === 'entry' ? 'italic ' : ''}${fontSize}px IBM Plex Sans, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = node.kind === 'entry' ? '#93846f' : '#e3d8c5';
      const label = node.label.length > 26 ? `${node.label.slice(0, 25)}...` : node.label;
      ctx.fillText(label, x, y + r + 4 * px);
      ctx.globalAlpha = 1;
    },
    [isLit, selected],
  );

  const selectedInfo = useMemo(() => {
    if (!selected || !data) return null;
    const entry = data.entries.find((e) => e.id === selected);
    if (entry) {
      const linked = data.mentions.filter((m) => m.entryId === entry.id).map((m) => data.nodes.find((n) => n.id === m.nodeId)).filter(Boolean);
      return { type: 'entry' as const, entry, linked };
    }
    const node = data.nodes.find((n) => n.id === selected);
    if (!node) return null;
    const ms = data.mentions.filter((m) => m.nodeId === node.id);
    const entries = ms
      .map((m) => {
        const e = data.entries.find((x) => x.id === m.entryId);
        if (!e) return null;
        const block = m.blockId ? e.blocks.find((b) => b.id === m.blockId) : null;
        const snippet = block ? block.text : e.blocks.find((b) => b.text.toLowerCase().includes(node.label.toLowerCase()))?.text ?? e.blocks[0]?.text ?? '';
        return { entry: e, snippet, source: m.source, confirmed: m.confirmed };
      })
      .filter(Boolean)
      .sort((a, b) => b!.entry.localDay.localeCompare(a!.entry.localDay)) as { entry: (typeof data.entries)[number]; snippet: string; source: string; confirmed: boolean }[];
    const coNodes = data.edges
      .filter((e) => e.sourceId === node.id || e.targetId === node.id)
      .map((e) => ({ node: data.nodes.find((n) => n.id === (e.sourceId === node.id ? e.targetId : e.sourceId)), weight: e.weight }))
      .filter((x) => x.node)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6);
    return { type: 'node' as const, node, entries, coNodes };
  }, [selected, data]);

  // Centre the found node in the part of the canvas the side panel leaves visible.
  const FOCUS_ZOOM = 1.8;
  const PANEL_W = 360;
  const focusNode = useCallback((n: GNode) => {
    setSelected(n.id);
    if (n.x !== undefined && n.y !== undefined) {
      fgRef.current?.centerAt(n.x + PANEL_W / 2 / FOCUS_ZOOM, n.y, 600);
      fgRef.current?.zoom(FOCUS_ZOOM, 600);
    }
  }, []);

  // Fit the view once per layout, not every time the simulation settles.
  const fittedRef = useRef(false);
  useEffect(() => {
    fittedRef.current = false;
  }, [graph]);

  // The side panel overlays the canvas, so opening it never resizes the
  // graph or shifts what you were looking at.
  return (
    <div className="relative h-full">
      <div className="flex h-full min-w-0 flex-col">
        <div ref={wrapRef} className="relative min-h-0 flex-1 bg-ink-950" data-testid="graph-canvas">
          {graph.nodes.length > 0 && <GraphFinder nodes={graph.nodes} onPick={focusNode} />}
          {graph.nodes.length === 0 ? (
            <p className="absolute inset-0 flex items-center justify-center px-8 text-center text-[13.5px] text-paper-500">
              Nothing to map yet. Finish an entry, or tag people, themes and values with @, # and $ as you write.
            </p>
          ) : (
            <ForceGraph2D
              ref={fgRef as never}
              width={size.w}
              height={size.h}
              graphData={graph}
              backgroundColor="#15120f"
              nodeId="id"
              nodeLabel={((n: GNode) => `${KIND_STYLE[n.kind].singular}: ${n.label}`) as never}
              nodeCanvasObject={drawNode as never}
              nodePointerAreaPaint={((node: GNode, color: string, ctx: CanvasRenderingContext2D, scale: number) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x ?? 0, node.y ?? 0, 14 / scale, 0, Math.PI * 2);
                ctx.fill();
              }) as never}
              maxZoom={3}
              linkColor={((l: GLink) => {
                const lit = !focus || idOf(l.source) === focus || idOf(l.target) === focus;
                if (l.kind === 'co') return lit ? 'rgba(224,170,74,0.45)' : 'rgba(224,170,74,0.08)';
                return lit ? 'rgba(196,180,155,0.38)' : 'rgba(196,180,155,0.07)';
              }) as never}
              linkWidth={((l: GLink) => (l.kind === 'co' ? Math.min(4, 0.8 + l.weight * 0.6) : 1)) as never}
              onNodeHover={((n: GNode | null) => setHover(n?.id ?? null)) as never}
              onNodeClick={((n: GNode) => setSelected(n.id)) as never}
              onBackgroundClick={() => setSelected(null)}
              cooldownTicks={120}
              onEngineStop={() => {
                if (fittedRef.current) return;
                fittedRef.current = true;
                fgRef.current?.zoomToFit(400, 90);
              }}
            />
          )}
        </div>
      </div>

      {selectedInfo && (
        <aside className="nr-rise absolute inset-y-0 right-0 z-20 flex w-[360px] flex-col border-l border-ink-800 bg-ink-950 shadow-[-12px_0_24px_rgba(0,0,0,0.25)]" aria-label="Selected item">
          <div className="flex items-start justify-between gap-2 border-b border-ink-800 px-5 py-4">
            {selectedInfo.type === 'node' ? (
              <div>
                <p className="flex items-center gap-1.5 text-[12px] text-paper-500">
                  <LegendShape kind={selectedInfo.node.kind} />
                  {KIND_STYLE[selectedInfo.node.kind].singular}
                </p>
                <h2 className="mt-1 font-serif text-[1.3rem] text-paper-50">{selectedInfo.node.label}</h2>
                <p className="mt-1 text-[12.5px] text-paper-500">
                  In {selectedInfo.entries.length} {selectedInfo.entries.length === 1 ? 'entry' : 'entries'}, first {formatDay(selectedInfo.node.firstSeen)}, latest {formatDay(selectedInfo.node.lastSeen)}
                </p>
              </div>
            ) : (
              <div>
                <p className="text-[12px] text-paper-500">Entry, {formatDay(selectedInfo.entry.localDay)}</p>
                <h2 className="mt-1 font-serif text-[1.3rem] text-paper-50">{selectedInfo.entry.title || 'Untitled'}</h2>
              </div>
            )}
            <button type="button" aria-label="Close" onClick={() => setSelected(null)} className="rounded p-1 text-paper-500 hover:text-paper-100">
              <X size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {selectedInfo.type === 'node' ? (
              <>
                {selectedInfo.coNodes.length > 0 && (
                  <div className="mb-5">
                    <p className="text-[12px] text-paper-500">Often appears with</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {selectedInfo.coNodes.map(({ node, weight }) => (
                        <button key={node!.id} type="button" onClick={() => setSelected(node!.id)} className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 px-2.5 py-1 text-[12px] text-paper-100 hover:bg-ink-900">
                          <LegendShape kind={node!.kind} />
                          {node!.label}
                          <span className="text-paper-500">{weight}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[12px] text-paper-500">Linked entries</p>
                <ol className="mt-2 space-y-2">
                  {selectedInfo.entries.map(({ entry, snippet, source, confirmed }) => (
                    <li key={entry.id}>
                      <button type="button" onClick={() => openEntry(entry.id)} className="w-full rounded-lg bg-ink-900 p-3 text-left hover:bg-ink-850">
                        <span className="flex items-start justify-between gap-3">
                          <span className="font-serif text-[14.5px] text-paper-50">{entry.title || 'Untitled'}</span>
                          <span className="shrink-0 whitespace-nowrap pt-0.5 text-[11.5px] text-paper-500">{formatDay(entry.localDay)}</span>
                        </span>
                        <span className="mt-1 line-clamp-3 block font-serif text-[13px] leading-5 text-paper-300">{snippet}</span>
                        <span className="mt-1.5 block text-[11px] text-paper-500">
                          {source === 'explicit_tag' ? 'You tagged this' : confirmed ? 'Suggested, confirmed by you' : 'Suggested automatically'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <>
                <p className="line-clamp-6 font-serif text-[14px] leading-6 text-paper-300">{selectedInfo.entry.blocks.map((b) => b.text).join(' ')}</p>
                <button type="button" onClick={() => openEntry(selectedInfo.entry.id)} className="mt-4 rounded-lg bg-ember-400 px-3 py-1.5 text-[13px] font-medium text-ink-950 hover:bg-ember-300">
                  Open in journal
                </button>
                {selectedInfo.linked.length > 0 && (
                  <>
                    <p className="mt-5 text-[12px] text-paper-500">Linked in this entry</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {selectedInfo.linked.map((n) => (
                        <button key={n!.id} type="button" onClick={() => setSelected(n!.id)} className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 px-2.5 py-1 text-[12px] text-paper-100 hover:bg-ink-900">
                          <LegendShape kind={n!.kind} />
                          {n!.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
