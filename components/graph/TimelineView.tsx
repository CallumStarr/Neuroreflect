'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, X } from 'lucide-react';
import { getDB } from '@/lib/db';
import { useUI } from '@/lib/store';
import type { Entry, Forecast, GraphNode, NodeKind } from '@/lib/types';
import { addDays, formatDay, localDayOf } from '@/lib/util';
import { KIND_STYLE, KindMark, LegendShape, NODE_KINDS, type Kind } from './kinds';

export type TimelineRange = '14' | '30' | '90' | 'all';

const LABEL_W = 212;
const ROW_H = 30;
const LANE_CAP = 8;
const GRID = '#231e19';
const DIM = 0.22;
const FORECAST_COLOR = '#c4b49b';

interface Occurrence {
  entry: Entry;
  /** Text around the mention, or the opening of the entry. */
  snippet: string;
}
interface Lane {
  node: GraphNode;
  days: Map<string, Occurrence[]>;
  entryIds: Set<string>;
  lastDay: string;
}
type Hover = { x: number; y: number; title: string; lines: { heading: string; body?: string }[] };

// A callback ref, so measuring starts whenever the element appears (the
// chart only mounts once its data has loaded).
function useMeasuredWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [w, setW] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    observer.current = ro;
  }, []);
  return [ref, w];
}

const dayNumber = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
const weekday = (day: string) => new Date(dayNumber(day) * 86400000).getUTCDay();
const short = (day: string) => formatDay(day, { day: 'numeric', month: 'short' });

function entryText(e: Entry): string {
  return `${e.title}\n${e.blocks.map((b) => b.text).join('\n')}`;
}

function clip(text: string, start: number, end: number, max = 160): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const mid = Math.floor((start + end) / 2);
  let a = Math.max(0, mid - Math.floor(max / 2));
  const b = Math.min(t.length, a + max);
  a = Math.max(0, b - max);
  const head = a > 0 ? t.indexOf(' ', a) + 1 || a : 0;
  const tailSpace = b < t.length ? t.lastIndexOf(' ', b) : b;
  const tail = tailSpace > head ? tailSpace : b;
  const cut = tail < t.length;
  const body = t.slice(head, tail);
  return `${head > 0 ? '...' : ''}${cut ? body.replace(/[\s.,;:!?]+$/, '') : body}${cut ? '...' : ''}`;
}

function firstText(e: Entry): string {
  const b = e.blocks.find((x) => x.text.trim());
  return b ? clip(b.text, 0, 0) : '';
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let at = lower.indexOf(query);
  while (at >= 0) {
    if (at > i) parts.push(text.slice(i, at));
    parts.push(
      <mark key={at} className="rounded-sm bg-ember-400/25 px-px text-paper-50">
        {text.slice(at, at + query.length)}
      </mark>,
    );
    i = at + query.length;
    at = lower.indexOf(query, i);
  }
  parts.push(text.slice(i));
  return <>{parts}</>;
}

function ticksFor(days: string[], plotW: number, today: string): { day: string; label: string }[] {
  const n = days.length;
  if (!n || plotW <= 0) return [];
  const perDay = plotW / n;
  const minGap = 62;
  const step = [1, 2, 3].find((s) => s * perDay >= minGap);
  if (step) return days.filter((_, i) => (n - 1 - i) % step === 0).map((d) => ({ day: d, label: d === today ? 'Today' : short(d) }));
  const weeks = [1, 2].find((w) => w * 7 * perDay >= minGap);
  if (weeks) {
    const mondays = days.filter((d) => weekday(d) === 1);
    return mondays.filter((_, i) => (mondays.length - 1 - i) % weeks === 0).map((d) => ({ day: d, label: short(d) }));
  }
  const months = [1, 2, 3, 6, 12].find((m) => m * 30.4 * perDay >= minGap) ?? 12;
  const firsts = days.filter((d) => d.endsWith('-01'));
  const spansYears = days[0].slice(0, 4) !== days[n - 1].slice(0, 4);
  return firsts
    .filter((d) => (Number(d.slice(5, 7)) - 1) % months === 0)
    .map((d) => ({ day: d, label: formatDay(d, spansYears ? { month: 'short', year: 'numeric' } : { month: 'long' }) }));
}

export default function TimelineView({ hidden, range }: { hidden: Set<Kind>; range: TimelineRange }) {
  const { openEntry } = useUI();
  const [chartRef, chartW] = useMeasuredWidth();
  const lanesRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<NodeKind>>(new Set());
  const [hover, setHover] = useState<Hover | null>(null);
  const [crosshair, setCrosshair] = useState<number | null>(null);

  const data = useLiveQuery(async () => {
    const db = getDB();
    const [entries, nodes, mentions, telemetry, forecasts] = await Promise.all([
      db.entries.toArray(),
      db.nodes.toArray(),
      db.mentions.toArray(),
      db.telemetry.toArray(),
      db.forecasts.toArray(),
    ]);
    return { entries, nodes, mentions, telemetry, forecasts };
  }, []);

  const today = localDayOf();
  const q = query.trim().toLowerCase();

  const view = useMemo(() => {
    if (!data) return null;
    const written = data.entries.filter((e) => e.wordCount > 0);
    const earliest = [...written.map((e) => e.localDay), ...data.forecasts.map((f) => f.targetDate)].sort()[0] ?? today;
    const start = range === 'all' ? (earliest < today ? earliest : addDays(today, -13)) : addDays(today, -(Number(range) - 1));
    const end = today;
    const days: string[] = [];
    for (let d = start; d <= end && days.length < 4000; d = addDays(d, 1)) days.push(d);

    const entries = written.filter((e) => e.localDay >= start && e.localDay <= end).sort((a, b) => (a.localDay === b.localDay ? b.createdAt.localeCompare(a.createdAt) : b.localDay.localeCompare(a.localDay)));
    const entryById = new Map(entries.map((e) => [e.id, e]));
    const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
    const rumination = new Set(data.telemetry.filter((t) => t.ruminationFlag).map((t) => t.entryId));
    const matches = (e: Entry) => !q || entryText(e).toLowerCase().includes(q);

    const lanesByNode = new Map<string, Lane>();
    const nodesByEntry = new Map<string, GraphNode[]>();
    for (const m of data.mentions) {
      const entry = entryById.get(m.entryId);
      const node = nodeById.get(m.nodeId);
      if (!entry || !node) continue;
      if (!nodesByEntry.has(entry.id)) nodesByEntry.set(entry.id, []);
      const list = nodesByEntry.get(entry.id)!;
      if (!list.some((n) => n.id === node.id)) list.push(node);
      const block = m.blockId ? entry.blocks.find((b) => b.id === m.blockId) : undefined;
      const snippet = block ? clip(block.text, m.start, m.end) : firstText(entry);
      let lane = lanesByNode.get(node.id);
      if (!lane) {
        lane = { node, days: new Map(), entryIds: new Set(), lastDay: entry.localDay };
        lanesByNode.set(node.id, lane);
      }
      if (lane.entryIds.has(entry.id)) continue;
      lane.entryIds.add(entry.id);
      if (entry.localDay > lane.lastDay) lane.lastDay = entry.localDay;
      if (!lane.days.has(entry.localDay)) lane.days.set(entry.localDay, []);
      lane.days.get(entry.localDay)!.push({ entry, snippet });
    }

    const groups = NODE_KINDS.filter((k) => !hidden.has(k))
      .map((kind) => ({
        kind,
        lanes: [...lanesByNode.values()]
          .filter((l) => l.node.kind === kind)
          .sort((a, b) => b.entryIds.size - a.entryIds.size || b.lastDay.localeCompare(a.lastDay) || a.node.label.localeCompare(b.node.label)),
      }))
      .filter((g) => g.lanes.length > 0);

    const entryDays = new Map<string, Entry[]>();
    for (const e of entries) {
      if (!entryDays.has(e.localDay)) entryDays.set(e.localDay, []);
      entryDays.get(e.localDay)!.push(e);
    }
    const forecastDays = new Map<string, Forecast[]>();
    for (const f of data.forecasts) {
      if (f.targetDate < start || f.targetDate > end) continue;
      if (!forecastDays.has(f.targetDate)) forecastDays.set(f.targetDate, []);
      forecastDays.get(f.targetDate)!.push(f);
    }
    return { days, start, entries, entryById, groups, entryDays, forecastDays, rumination, nodesByEntry, lanesByNode, matches };
  }, [data, range, hidden, q, today]);

  // Drop a selection that the filters have hidden.
  useEffect(() => {
    if (selected && view && !view.groups.some((g) => g.lanes.some((l) => l.node.id === selected))) setSelected(null);
  }, [selected, view]);

  if (!view) return null;

  const plotW = Math.max(0, chartW - LABEL_W - 20);
  const n = view.days.length;
  const first = n ? dayNumber(view.days[0]) : 0;
  const xOf = (day: string) => ((dayNumber(day) - first + 0.5) / Math.max(1, n)) * plotW;
  const ticks = ticksFor(view.days, plotW, today);
  const selectedLane = selected ? view.lanesByNode.get(selected) : undefined;

  const bright = (entryIds: string[], ownLane = false) => {
    const okSelection = !selectedLane || ownLane || entryIds.some((id) => selectedLane.entryIds.has(id));
    const okQuery = !q || entryIds.some((id) => view.matches(view.entryById.get(id)!));
    return okSelection && okQuery;
  };

  const showHover = (ev: React.MouseEvent<SVGGElement>, x: number, title: string, lines: Hover['lines']) => {
    const host = lanesRef.current;
    if (!host) return;
    const box = ev.currentTarget.getBoundingClientRect();
    const hostBox = host.getBoundingClientRect();
    setHover({ x: box.left + box.width / 2 - hostBox.left, y: box.top - hostBox.top, title, lines });
    setCrosshair(x);
  };
  const clearHover = () => {
    setHover(null);
    setCrosshair(null);
  };

  const grid = (
    <g aria-hidden>
      {ticks.map((t) => (
        <line key={t.day} x1={xOf(t.day)} x2={xOf(t.day)} y1={0} y2={ROW_H} stroke={GRID} strokeWidth={1} />
      ))}
    </g>
  );

  const list = view.entries.filter((e) => view.matches(e) && (!selectedLane || selectedLane.entryIds.has(e.id)));
  const snippetFor = (e: Entry): string => {
    if (q) {
      for (const b of e.blocks) {
        const at = b.text.toLowerCase().indexOf(q);
        if (at >= 0) return clip(b.text, at, at + q.length);
      }
    }
    if (selectedLane) {
      for (const occs of selectedLane.days.values()) {
        const hit = occs.find((o) => o.entry.id === e.id);
        if (hit) return hit.snippet;
      }
    }
    return firstText(e);
  };

  const nothing = view.entries.length === 0 && view.forecastDays.size === 0;

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto" onMouseLeave={clearHover}>
        <div ref={chartRef} className="px-6 pb-10 pt-4">
          {nothing ? (
            <p className="py-24 text-center text-[13.5px] text-paper-500">Nothing on the timeline in this range. Finish an entry, or tag people, themes and values with @, # and $ as you write.</p>
          ) : (
            plotW > 0 && (
              <div ref={lanesRef} className="relative" data-testid="timeline-lanes">
                {/* Date axis, kept in view while the lanes scroll. */}
                <div className="sticky top-0 z-10 flex h-8 items-end border-b border-ink-800 bg-ink-950">
                  <div style={{ width: LABEL_W }} className="shrink-0 pb-1.5 text-[11.5px] text-paper-500">
                    {formatDay(view.days[0], { day: 'numeric', month: 'short', year: 'numeric' })} to today
                  </div>
                  <svg width={plotW} height={32} aria-hidden className="overflow-visible">
                    {ticks.map((t) => (
                      <text key={t.day} x={xOf(t.day)} y={22} textAnchor="middle" fontSize={11.5} fill={t.label === 'Today' ? '#e3d8c5' : '#93846f'} fontFamily="IBM Plex Sans, system-ui, sans-serif">
                        {t.label}
                      </text>
                    ))}
                  </svg>
                </div>

                {crosshair !== null && <div className="pointer-events-none absolute bottom-0 top-8 z-0 w-px bg-ember-400/35" style={{ left: LABEL_W + crosshair }} aria-hidden />}

                {/* Entries */}
                {!hidden.has('entry') && (
                  <div className="flex items-center border-b border-ink-850" style={{ height: ROW_H + 6 }}>
                    <div style={{ width: LABEL_W }} className="flex shrink-0 items-center gap-2 pr-3 text-[12.5px] text-paper-300">
                      <LegendShape kind="entry" />
                      Entries
                      <span className="nr-num ml-auto text-paper-500">{view.entries.length}</span>
                    </div>
                    <svg width={plotW} height={ROW_H} role="img" aria-label={`${view.entries.length} entries in this range`}>
                      {grid}
                      {[...view.entryDays].map(([day, list]) => {
                        const x = xOf(day);
                        const on = bright(list.map((e) => e.id));
                        return (
                          <g
                            key={day}
                            className="cursor-pointer"
                            onMouseEnter={(ev) =>
                              showHover(
                                ev,
                                x,
                                formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' }),
                                list.map((e) => ({ heading: e.title || 'Untitled', body: firstText(e) })),
                              )
                            }
                            onMouseLeave={clearHover}
                            onClick={() => openEntry(list[0].id)}
                          >
                            <rect x={x - 11} y={2} width={22} height={ROW_H - 4} fill="transparent" />
                            <KindMark kind="entry" x={x} y={ROW_H / 2} r={list.length > 1 ? 6 : 5} opacity={on ? 1 : DIM} />
                            {list.some((e) => view.rumination.has(e.id)) && (
                              <circle cx={x} cy={ROW_H / 2} r={9.5} fill="none" stroke={KIND_STYLE.pattern.color} strokeWidth={1.5} opacity={on ? 0.9 : DIM} />
                            )}
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                )}

                {view.groups.map(({ kind, lanes }) => {
                  const open = expanded.has(kind);
                  const shown = open ? lanes : lanes.slice(0, LANE_CAP);
                  return (
                    <div key={kind} className="mt-3">
                      <div className="flex h-7 items-center gap-2 text-[12px] text-paper-500">
                        <LegendShape kind={kind} />
                        {KIND_STYLE[kind].label}
                        <span className="nr-num">{lanes.length}</span>
                      </div>
                      {shown.map((lane) => {
                        const isSel = selected === lane.node.id;
                        return (
                          <div key={lane.node.id} className={`flex items-center rounded-md ${isSel ? 'bg-ink-900' : ''}`} style={{ height: ROW_H }}>
                            <button
                              type="button"
                              aria-pressed={isSel}
                              onClick={() => setSelected(isSel ? null : lane.node.id)}
                              title={isSel ? 'Show all entries' : `Show entries with ${lane.node.label}`}
                              style={{ width: LABEL_W }}
                              className={`flex h-full shrink-0 items-center gap-2 rounded-md pl-2 pr-3 text-left text-[13px] ${isSel ? 'text-paper-50' : 'text-paper-100 hover:bg-ink-900'}`}
                            >
                              <span className="truncate">{lane.node.label}</span>
                              <span className="nr-num ml-auto text-[12px] text-paper-500">{lane.entryIds.size}</span>
                            </button>
                            <svg
                              width={plotW}
                              height={ROW_H}
                              role="img"
                              aria-label={`${KIND_STYLE[kind].singular} ${lane.node.label}: in ${lane.entryIds.size} ${lane.entryIds.size === 1 ? 'entry' : 'entries'}, latest ${formatDay(lane.lastDay)}`}
                            >
                              {grid}
                              {[...lane.days].map(([day, occs]) => {
                                const x = xOf(day);
                                const on = bright(
                                  occs.map((o) => o.entry.id),
                                  isSel,
                                );
                                return (
                                  <g
                                    key={day}
                                    className="cursor-pointer"
                                    onMouseEnter={(ev) =>
                                      showHover(
                                        ev,
                                        x,
                                        `${KIND_STYLE[kind].singular}: ${lane.node.label}`,
                                        occs.map((o) => ({ heading: `${formatDay(day)}, ${o.entry.title || 'Untitled'}`, body: o.snippet })),
                                      )
                                    }
                                    onMouseLeave={clearHover}
                                    onClick={() => openEntry(occs[0].entry.id)}
                                  >
                                    <rect x={x - 11} y={2} width={22} height={ROW_H - 4} fill="transparent" />
                                    <KindMark kind={kind} x={x} y={ROW_H / 2} r={occs.length > 1 ? 6 : 5} opacity={on ? 1 : DIM} />
                                  </g>
                                );
                              })}
                            </svg>
                          </div>
                        );
                      })}
                      {lanes.length > LANE_CAP && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((s) => {
                              const next = new Set(s);
                              if (next.has(kind)) next.delete(kind);
                              else next.add(kind);
                              return next;
                            })
                          }
                          className="ml-2 mt-1 text-[12px] text-paper-500 underline decoration-ink-600 underline-offset-2 hover:text-paper-100"
                        >
                          {open ? 'Show fewer' : `Show ${lanes.length - LANE_CAP} more ${KIND_STYLE[kind].label.toLowerCase()}`}
                        </button>
                      )}
                    </div>
                  );
                })}

                {/* Forecasts */}
                {view.forecastDays.size > 0 && (
                  <div className="mt-3">
                    <div className="flex h-7 items-center gap-2 text-[12px] text-paper-500">
                      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                        <path d="M7 1.8 L12.2 7 L7 12.2 L1.8 7 Z" fill="none" stroke={FORECAST_COLOR} strokeWidth="1.6" />
                      </svg>
                      Forecast events
                    </div>
                    <div className="flex items-center" style={{ height: ROW_H }}>
                      <div style={{ width: LABEL_W }} className="shrink-0 pl-2 pr-3 text-[12.5px] leading-4 text-paper-500">
                        Filled once you log how it went
                      </div>
                      <svg width={plotW} height={ROW_H} role="img" aria-label={`${[...view.forecastDays.values()].flat().length} forecast events in this range`}>
                        {grid}
                        {[...view.forecastDays].map(([day, fs]) => {
                          const x = xOf(day);
                          const resolved = fs.every((f) => f.actualImpact !== null);
                          const r = 6;
                          return (
                            <g
                              key={day}
                              className={fs.some((f) => f.entryId) ? 'cursor-pointer' : ''}
                              onMouseEnter={(ev) =>
                                showHover(
                                  ev,
                                  x,
                                  formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' }),
                                  fs.map((f) => ({
                                    heading: f.eventName,
                                    body: f.actualImpact === null ? `Dread forecast ${f.predictedDread}. Awaiting a reality check.` : `Dread forecast ${f.predictedDread}, actual impact ${f.actualImpact}.`,
                                  })),
                                )
                              }
                              onMouseLeave={clearHover}
                              onClick={() => {
                                const linked = fs.find((f) => f.entryId)?.entryId;
                                if (linked) openEntry(linked);
                              }}
                            >
                              <rect x={x - 11} y={2} width={22} height={ROW_H - 4} fill="transparent" />
                              <path
                                d={`M${x} ${ROW_H / 2 - r} L${x + r} ${ROW_H / 2} L${x} ${ROW_H / 2 + r} L${x - r} ${ROW_H / 2} Z`}
                                fill={resolved ? FORECAST_COLOR : 'none'}
                                stroke={FORECAST_COLOR}
                                strokeWidth={1.6}
                              />
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  </div>
                )}

                {hover && (
                  <div
                    role="tooltip"
                    className="pointer-events-none absolute z-20 w-[300px] rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5 shadow-xl"
                    style={{
                      left: Math.min(Math.max(hover.x - 150, 0), Math.max(0, chartW - 48 - 300)),
                      top: hover.y > 170 ? undefined : hover.y + 26,
                      bottom: hover.y > 170 ? `calc(100% - ${hover.y - 6}px)` : undefined,
                    }}
                  >
                    <p className="text-[12px] text-paper-500">{hover.title}</p>
                    {hover.lines.slice(0, 3).map((l, i) => (
                      <div key={i} className="mt-1.5">
                        <p className="text-[13px] text-paper-50">{l.heading}</p>
                        {l.body && <p className="mt-0.5 line-clamp-3 font-serif text-[12.5px] leading-[1.15rem] text-paper-300">{l.body}</p>}
                      </div>
                    ))}
                    {hover.lines.length > 3 && <p className="mt-1.5 text-[12px] text-paper-500">and {hover.lines.length - 3} more</p>}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </div>

      <aside className="flex w-[372px] shrink-0 flex-col border-l border-ink-800 bg-ink-950" aria-label="Timeline entries">
        <div className="border-b border-ink-800 px-5 pb-3 pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="min-w-0 truncate text-[14px] text-paper-50">{selectedLane ? `Entries with ${selectedLane.node.label}` : 'Entries in this range'}</h2>
            <span className="nr-num shrink-0 text-[12px] text-paper-500">{list.length}</span>
          </div>
          {selectedLane && (
            <button type="button" onClick={() => setSelected(null)} className="mt-1 inline-flex items-center gap-1 text-[12px] text-paper-500 hover:text-paper-100">
              <X size={12} /> Show all entries
            </button>
          )}
          <div className="relative mt-2.5">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-paper-500" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search entries"
              placeholder="Search entries"
              className="w-full rounded-lg border border-ink-700 bg-ink-900 py-1.5 pl-8 pr-2 text-[13px] text-paper-50 placeholder:text-paper-500 focus:border-ember-400 focus:outline-none"
            />
          </div>
        </div>
        <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3" data-testid="timeline-entries">
          {list.map((e) => {
            const nodes = view.nodesByEntry.get(e.id) ?? [];
            const visibleNodes = nodes.filter((nd) => !hidden.has(nd.kind));
            return (
              <li key={e.id}>
                <button type="button" onClick={() => openEntry(e.id)} className="w-full rounded-lg p-3 text-left hover:bg-ink-900">
                  <span className="flex items-center gap-2 text-[11.5px] text-paper-500">
                    <span className="whitespace-nowrap">{formatDay(e.localDay)}</span>
                    {view.rumination.has(e.id) && <span className="text-rose-300">Writing circled</span>}
                    {e.status === 'draft' && <span className="text-ember-300">Draft</span>}
                    <span className="nr-num ml-auto">{e.wordCount} words</span>
                  </span>
                  <span className="mt-1 block font-serif text-[14.5px] leading-5 text-paper-50">
                    <Highlight text={e.title || 'Untitled'} query={q} />
                  </span>
                  <span className="mt-1 line-clamp-3 block font-serif text-[13px] leading-5 text-paper-300">
                    <Highlight text={snippetFor(e)} query={q} />
                  </span>
                  {visibleNodes.length > 0 && (
                    <span className="mt-2 flex flex-wrap gap-1">
                      {visibleNodes.slice(0, 5).map((nd) => (
                        <span key={nd.id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] ${nd.id === selected ? 'border-ember-400/60 text-paper-50' : 'border-ink-700 text-paper-300'}`}>
                          <LegendShape kind={nd.kind} />
                          {nd.label}
                        </span>
                      ))}
                      {visibleNodes.length > 5 && <span className="px-1 py-0.5 text-[11.5px] text-paper-500">+{visibleNodes.length - 5}</span>}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {list.length === 0 && (
            <li className="px-3 py-8 text-center text-[13px] leading-5 text-paper-500">
              {q ? `No entries in this range mention "${query.trim()}".` : 'No entries in this range.'}
            </li>
          )}
        </ol>
      </aside>
    </div>
  );
}
