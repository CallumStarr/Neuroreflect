'use client';

import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { AXIS_TICK, CHART } from '@/lib/chart-theme';

// Custom SVG charts draw at their measured pixel width so text renders at true size.
function useMeasuredWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ---------- shared pieces ----------

export function ChartPanel({ title, description, children, table, legend }: { title: string; description: string; children: React.ReactNode; table: React.ReactNode; legend?: React.ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="rounded-xl border border-ink-800 bg-ink-900 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[15px] font-medium text-paper-50">{title}</h3>
          <p className="mt-0.5 max-w-[60ch] text-[12.5px] leading-5 text-paper-500">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-pressed={showTable}
          className="shrink-0 rounded-md px-2 py-1 text-[12px] text-paper-500 hover:bg-ink-800 hover:text-paper-100"
        >
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {legend && !showTable && <div className="mt-3 flex flex-wrap gap-4">{legend}</div>}
      <div className="mt-3">{showTable ? table : children}</div>
    </section>
  );
}

export function LegendItem({ color, label, shape = 'dot' }: { color: string; label: string; shape?: 'dot' | 'line' }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-paper-300">
      {shape === 'dot' ? <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} /> : <span className="h-0.5 w-4 rounded" style={{ background: color }} />}
      {label}
    </span>
  );
}

export function DataTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-ink-700 text-paper-500">
            {columns.map((c) => (
              <th key={c} className="py-2 pr-4 font-normal">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-ink-800 text-paper-100">
              {r.map((cell, j) => (
                <td key={j} className={`py-2 pr-4 ${typeof cell === 'number' ? 'nr-num' : ''}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="py-3 text-[12.5px] text-paper-500">No data in this range.</p>}
    </div>
  );
}

function TooltipBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-[12.5px] text-paper-100 shadow-lg">{children}</div>;
}

export function EmptyChart({ message }: { message: string }) {
  return <p className="flex h-[180px] items-center justify-center px-6 text-center text-[13px] leading-5 text-paper-500">{message}</p>;
}

// ---------- calibration dumbbell ----------

export interface CalibrationRow {
  id: string;
  label: string;
  date: string;
  predicted: number;
  actual: number | null;
  predictedCoping: number;
  actualCoping: number | null;
  worstCase: string;
}

export function CalibrationDumbbell({ rows }: { rows: CalibrationRow[] }) {
  const [wrapRef, measured] = useMeasuredWidth();
  return (
    <div ref={wrapRef} className="w-full">
      {measured > 0 && <CalibrationSvg rows={rows} width={measured} />}
    </div>
  );
}

function CalibrationSvg({ rows, width }: { rows: CalibrationRow[]; width: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const rowH = 48;
  const left = Math.min(230, Math.max(160, width * 0.34));
  const right = 104;
  const plotW = Math.max(120, width - left - right);
  const top = 26;
  const height = top + rows.length * rowH + 30;
  const x = (v: number) => left + (v / 100) * plotW;
  const hovered = rows.find((r) => r.id === hover);

  const maxChars = Math.floor((left - 16) / 6.8);
  return (
    <div className="relative">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block" role="img" aria-label="Predicted dread versus actual impact for each forecast">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={top - 8} y2={height - 26} stroke={CHART.grid} strokeWidth={1} />
            <text x={x(v)} y={height - 8} textAnchor="middle" {...AXIS_TICK}>
              {v}
            </text>
          </g>
        ))}
        <text x={left} y={12} fontSize={11.5} fill={CHART.textMuted}>
          Dread, 0 to 100
        </text>
        {rows.map((r, i) => {
          const cy = top + i * rowH + rowH / 2;
          const delta = r.actual === null ? null : r.predicted - r.actual;
          const isHover = hover === r.id;
          return (
            <g
              key={r.id}
              onMouseEnter={() => setHover(r.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(r.id)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${r.label}: predicted ${r.predicted}${r.actual !== null ? `, actual ${r.actual}` : ', not yet checked'}`}
              style={{ outline: 'none' }}
            >
              <rect x={0} y={cy - rowH / 2} width={width} height={rowH} fill={isHover ? '#231e19' : 'transparent'} />
              <text x={4} y={cy - 3} fontSize={13} fill={CHART.textPrimary}>
                {r.label.length > maxChars ? `${r.label.slice(0, maxChars - 1).trimEnd()}...` : r.label}
                <title>{r.label}</title>
              </text>
              <text x={4} y={cy + 14} fontSize={11.5} fill={CHART.textMuted}>
                {r.date}
              </text>
              {r.actual !== null && <line x1={x(r.actual)} x2={x(r.predicted)} y1={cy} y2={cy} stroke={CHART.neutral} strokeWidth={2} strokeLinecap="round" />}
              <circle cx={x(r.predicted)} cy={cy} r={6} fill={CHART.warm} stroke={CHART.surface} strokeWidth={2} />
              {r.actual !== null && <circle cx={x(r.actual)} cy={cy} r={6} fill={CHART.cool} stroke={CHART.surface} strokeWidth={2} />}
              <text x={width - right + 16} y={cy + 4} fontSize={12.5} fill={delta === null ? CHART.textMuted : CHART.textSecondary}>
                {delta === null ? 'awaiting check' : delta === 0 ? 'spot on' : `${delta > 0 ? '+' : ''}${delta} ${delta > 0 ? 'over' : 'under'}`}
              </text>
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div className="pointer-events-none absolute right-4 top-2 w-[260px]">
          <TooltipBox>
            <p className="font-medium">{hovered.label}</p>
            <p className="text-paper-500">{hovered.date}</p>
            <p className="mt-1.5">
              Dread: predicted {hovered.predicted}
              {hovered.actual !== null ? `, actual ${hovered.actual}` : ''}
            </p>
            <p>
              Coping: predicted {hovered.predictedCoping}
              {hovered.actualCoping !== null ? `, actual ${hovered.actualCoping}` : ''}
            </p>
            {hovered.worstCase && <p className="mt-1.5 italic text-paper-300">&ldquo;{hovered.worstCase}&rdquo;</p>}
          </TooltipBox>
        </div>
      )}
    </div>
  );
}

// ---------- forecast error over time (signed columns) ----------

export interface ErrorPoint {
  label: string;
  event: string;
  delta: number;
}

function niceDomain(values: number[]): { domain: [number, number]; ticks: number[] } {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const lower = lo < 0 ? Math.floor((lo - 5) / 20) * 20 : 0;
  const upper = Math.max(20, Math.ceil((hi + 5) / 20) * 20);
  const ticks: number[] = [];
  for (let v = lower; v <= upper; v += 20) ticks.push(v);
  return { domain: [lower, upper], ticks };
}

export function ErrorColumns({ data, mean }: { data: ErrorPoint[]; mean: number }) {
  const { domain, ticks } = niceDomain(data.map((d) => d.delta));
  const Tip = ({ active, payload }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload as ErrorPoint;
    return (
      <TooltipBox>
        <p className="font-medium">{p.event}</p>
        <p className="text-paper-500">{p.label}</p>
        <p className="mt-1">{p.delta === 0 ? 'Forecast was exact' : `${p.delta > 0 ? 'Overestimated' : 'Underestimated'} by ${Math.abs(p.delta)}`}</p>
      </TooltipBox>
    );
  };
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 78, left: -8, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART.axis }} tickLine={false} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} domain={domain} ticks={ticks} />
          <ReferenceLine y={0} stroke={CHART.axis} />
          <ReferenceLine y={mean} stroke={CHART.textMuted} strokeWidth={1} label={{ value: `average ${mean > 0 ? '+' : ''}${mean.toFixed(0)}`, position: 'right', fill: CHART.textSecondary, fontSize: 11.5 }} />
          <Tooltip content={<Tip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Bar dataKey="delta" maxBarSize={24} radius={[4, 4, 4, 4]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.delta >= 0 ? CHART.warm : CHART.cool} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- single-series trend ----------

export interface TrendPoint {
  label: string;
  value: number;
  title: string;
}

export function TrendLine({ data, unit, domain, ticks, digits = 1 }: { data: TrendPoint[]; unit: string; domain: [number, number]; ticks?: number[]; digits?: number }) {
  const Tip = ({ active, payload }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload as TrendPoint;
    return (
      <TooltipBox>
        <p className="font-medium">{p.title}</p>
        <p className="text-paper-500">{p.label}</p>
        <p className="mt-1">
          {p.value.toFixed(digits)} {unit}
        </p>
      </TooltipBox>
    );
  };
  const last = data[data.length - 1];
  return (
    <div className="h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 18, right: 44, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART.axis }} tickLine={false} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} domain={domain} ticks={ticks} />
          <Tooltip content={<Tip />} cursor={{ stroke: CHART.axis, strokeWidth: 1 }} />
          <Line
            type="linear"
            dataKey="value"
            stroke={CHART.cool}
            strokeWidth={2}
            dot={{ r: 4, fill: CHART.cool, stroke: CHART.surface, strokeWidth: 2 }}
            activeDot={{ r: 6, fill: CHART.cool, stroke: CHART.surface, strokeWidth: 2 }}
            isAnimationActive={false}
            label={(props: { x?: number; y?: number; index?: number }) =>
              props.index === data.length - 1 && last ? (
                <text key="end" x={(props.x ?? 0) + 10} y={(props.y ?? 0) + 4} fontSize={12} fill={CHART.textSecondary}>
                  {last.value.toFixed(digits)}
                </text>
              ) : (
                <g key={`l${props.index}`} />
              )
            }
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- two-series language chart ----------

export interface LanguagePoint {
  label: string;
  title: string;
  self: number;
  sense: number;
}

export function LanguageLines({ data, threshold }: { data: LanguagePoint[]; threshold: number }) {
  const Tip = ({ active, payload }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload as LanguagePoint;
    return (
      <TooltipBox>
        <p className="font-medium">{p.title}</p>
        <p className="text-paper-500">{p.label}</p>
        <p className="mt-1 flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: CHART.warm }} /> Self-focus {p.self.toFixed(1)}%
        </p>
        <p className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: CHART.cool }} /> Making sense {p.sense.toFixed(1)}%
        </p>
      </TooltipBox>
    );
  };
  const last = data[data.length - 1];
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 18, right: 96, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART.axis }} tickLine={false} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} domain={[0, 20]} ticks={[0, 5, 10, 15, 20]} unit="%" />
          <ReferenceLine y={threshold * 100} stroke={CHART.axis} label={{ value: 'loop threshold', position: 'insideBottomLeft', fill: CHART.textMuted, fontSize: 11 }} />
          <Tooltip content={<Tip />} cursor={{ stroke: CHART.axis, strokeWidth: 1 }} />
          {(['self', 'sense'] as const).map((key) => {
            const color = key === 'self' ? CHART.warm : CHART.cool;
            const name = key === 'self' ? 'Self-focus' : 'Making sense';
            return (
              <Line
                key={key}
                type="linear"
                dataKey={key}
                stroke={color}
                strokeWidth={2}
                dot={{ r: 4, fill: color, stroke: CHART.surface, strokeWidth: 2 }}
                activeDot={{ r: 6, fill: color, stroke: CHART.surface, strokeWidth: 2 }}
                isAnimationActive={false}
                label={(props: { x?: number; y?: number; index?: number }) =>
                  props.index === data.length - 1 && last ? (
                    <text key="end" x={(props.x ?? 0) + 10} y={(props.y ?? 0) + 4} fontSize={12} fill={CHART.textSecondary}>
                      {name}
                    </text>
                  ) : (
                    <g key={`l${props.index}`} />
                  )
                }
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- diverging values bars ----------

export interface ValueRow {
  label: string;
  average: number;
  mentions: number;
}

export function ValuesBars({ rows }: { rows: ValueRow[] }) {
  const [wrapRef, measured] = useMeasuredWidth();
  return (
    <div ref={wrapRef} className="w-full">
      {measured > 0 && <ValuesSvg rows={rows} width={measured} />}
    </div>
  );
}

function ValuesSvg({ rows, width }: { rows: ValueRow[]; width: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const left = 120;
  const right = 132;
  const rowH = 40;
  const top = 10;
  const height = top + rows.length * rowH + 30;
  const plotW = width - left - right;
  const x = (v: number) => left + ((v + 2) / 4) * plotW;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block" role="img" aria-label="Average values alignment per core value">
      {[-2, -1, 0, 1, 2].map((v) => (
        <g key={v}>
          <line x1={x(v)} x2={x(v)} y1={top} y2={height - 26} stroke={v === 0 ? CHART.axis : CHART.grid} strokeWidth={1} />
          <text x={x(v)} y={height - 8} textAnchor="middle" {...AXIS_TICK}>
            {v > 0 ? `+${v}` : v}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const cy = top + i * rowH + rowH / 2;
        const x0 = x(0);
        const x1 = x(r.average);
        const w = Math.abs(x1 - x0);
        const color = r.average > 0.05 ? CHART.cool : r.average < -0.05 ? CHART.warm : CHART.neutral;
        const barH = 18;
        const radius = Math.min(4, w / 2);
        // Rounded at the data end only, square at the zero baseline.
        const d =
          r.average >= 0
            ? `M${x0},${cy - barH / 2} H${x0 + w - radius} Q${x0 + w},${cy - barH / 2} ${x0 + w},${cy - barH / 2 + radius} V${cy + barH / 2 - radius} Q${x0 + w},${cy + barH / 2} ${x0 + w - radius},${cy + barH / 2} H${x0} Z`
            : `M${x0},${cy - barH / 2} H${x0 - w + radius} Q${x0 - w},${cy - barH / 2} ${x0 - w},${cy - barH / 2 + radius} V${cy + barH / 2 - radius} Q${x0 - w},${cy + barH / 2} ${x0 - w + radius},${cy + barH / 2} H${x0} Z`;
        return (
          <g key={r.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={0} y={cy - rowH / 2} width={width} height={rowH} fill={hover === i ? '#231e19' : 'transparent'} />
            <text x={4} y={cy + 4} fontSize={13} fill={CHART.textPrimary}>
              {r.label}
            </text>
            {w > 0.5 ? <path d={d} fill={color} /> : <circle cx={x0} cy={cy} r={4} fill={CHART.neutral} />}
            <text x={width - right + 16} y={cy + 4} fontSize={12} fill={CHART.textSecondary}>
              {r.mentions ? `${r.average > 0 ? '+' : ''}${r.average.toFixed(1)}, ${r.mentions} ${r.mentions === 1 ? 'entry' : 'entries'}` : 'not mentioned'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
