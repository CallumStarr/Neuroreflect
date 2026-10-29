'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleCheck, Loader, RefreshCcw, X } from 'lucide-react';
import type { RuminationThresholds, Telemetry } from '@/lib/types';

export interface TraceSample {
  iTalk: number;
  cog: number;
  neg: number;
  fusion: number;
  gran: number;
}

interface Props {
  telemetry: Telemetry;
  trace: TraceSample[];
  thresholds: RuminationThresholds;
  ruminationActive: boolean;
  onStepBack: () => void;
  busy: boolean;
  /** Open and Blank guidance offer prompts only when asked, so no step-back alert appears. */
  suggestionsOff?: boolean;
  /** Hides the step-back alert for the rest of this entry. */
  onDismiss?: () => void;
}

// The trace draws at its real pixel width (measured), so lines and the end dot
// never stretch, and it shrinks with the window instead of overlapping neighbours.
function Trace(props: { values: number[]; max: number; threshold?: number; thresholdLabel?: string; invert?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="h-7 min-w-[44px] max-w-[112px] flex-1">
      {w > 0 && <TraceSvg {...props} W={w} />}
    </div>
  );
}

function TraceSvg({ values, max, threshold, thresholdLabel, invert, W }: { values: number[]; max: number; threshold?: number; thresholdLabel?: string; invert?: boolean; W: number }) {
  const H = 28;
  const pts = values.length ? values : [0];
  const y = (v: number) => {
    const t = Math.max(0, Math.min(1, v / max));
    return H - 2 - t * (H - 4);
  };
  const usable = W - 4; // leave room for the end dot
  const step2 = pts.length > 1 ? usable / (pts.length - 1) : usable;
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step2).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      {threshold !== undefined && (
        <>
          <line x1={0} x2={W} y1={y(threshold)} y2={y(threshold)} stroke="#3b332b" strokeWidth={1} />
          {thresholdLabel && W > 70 && (
            <text x={W - 6} y={y(threshold) - 3} textAnchor="end" fontSize={9} fill="#93846f">
              {thresholdLabel}
            </text>
          )}
        </>
      )}
      <path d={d} fill="none" stroke={invert ? '#6f93d9' : '#93846f'} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={(pts.length - 1) * step2} cy={y(last)} r={3} fill="#e0aa4a" stroke="#15120f" strokeWidth={2} />
    </svg>
  );
}

function Metric({ label, value, hint, children, alert, note, compact }: { label: string; value: string; hint: string; children?: React.ReactNode; alert?: boolean; note?: string; compact?: boolean }) {
  return (
    <div className={`flex shrink-0 items-center gap-2.5 px-3.5 ${compact ? '' : 'min-w-[150px] flex-1'}`} title={hint}>
      <div className="shrink-0">
        <p className="whitespace-nowrap text-[11.5px] text-paper-500">{label}</p>
        <p className={`nr-num whitespace-nowrap text-[17px] font-medium leading-6 ${alert ? 'text-rose-300' : 'text-paper-50'}`}>
          {value}
          {note && <span className="ml-1.5 text-[11.5px] font-normal text-paper-500">{note}</span>}
        </p>
      </div>
      {children}
    </div>
  );
}

export default function TelemetryBar({ telemetry: t, trace, thresholds, ruminationActive, onStepBack, busy, suggestionsOff, onDismiss }: Props) {
  const armed = t.wordCount > thresholds.minWords;
  const iTalkHigh = t.iTalkDensity > thresholds.iTalk;
  const cogLow = t.cogProcDensity < thresholds.cogProcMax;
  return (
    <section aria-label="Live writing measures" className="flex h-[74px] shrink-0 items-stretch border-t border-ink-800 bg-ink-950">
      <div className="flex min-w-0 flex-1 items-center divide-x divide-ink-800 overflow-x-auto">
        <Metric
          label="Self-focus"
          value={`${(t.iTalkDensity * 100).toFixed(1)}%`}
          hint="I, me, my and myself as a share of all words. High self-focus is one of the three signals behind the step-back suggestion. These measure words, not you."
          alert={armed && iTalkHigh}
        >
          <Trace values={trace.map((s) => s.iTalk)} max={0.25} threshold={thresholds.iTalk} thresholdLabel={`${Math.round(thresholds.iTalk * 100)}%`} />
        </Metric>
        <Metric
          label="Making sense"
          value={`${(t.cogProcDensity * 100).toFixed(1)}%`}
          hint="Causal and insight words, such as because, realise, although and perhaps, as a share of all words."
          alert={armed && cogLow && iTalkHigh}
        >
          <Trace values={trace.map((s) => s.cog)} max={0.08} threshold={thresholds.cogProcMax} invert />
        </Metric>
        <Metric label="Negative feeling" value={`${(t.negAffectDensity * 100).toFixed(1)}%`} hint="Negative feeling words as a share of all words.">
          <Trace values={trace.map((s) => s.neg)} max={0.15} threshold={thresholds.negAffect} />
        </Metric>
        <Metric
          label="Distance"
          value={`${t.fusionScore}`}
          hint={`Distance from thoughts, out of 100. ${t.fusedCount} phrase${t.fusedCount === 1 ? '' : 's'} written from inside a thought, as if simply true, and ${t.defusedCount} written as a thought you noticed. Hover an underlined phrase to rewrite it.`}
        >
          <Trace values={trace.map((s) => s.fusion)} max={100} invert />
        </Metric>
        <Metric
          compact
          label="Granularity"
          value={t.granularityIndex.toFixed(1)}
          note={t.coarseLabels.length ? `${t.coarseLabels.length} broad` : undefined}
          hint={`Distinct, precise emotion words per 1,000 words (${t.fineLabels.length} precise, ${t.coarseLabels.length} broad). Dashed underlines mark broad labels you could name more precisely.`}
        />
        <Metric compact label="Avoidance" value={`${t.avoidanceHits.length}`} hint={t.avoidanceHits.length ? `Avoidance cues found: ${t.avoidanceHits.join(', ')}` : 'Words describing escaping, numbing or putting things off.'} />
      </div>

      <div
        className={`flex w-[332px] shrink-0 items-center gap-3 border-l px-4 transition-colors ${
          ruminationActive ? 'border-rose-400/40 bg-rose-400/10' : 'border-ink-800'
        }`}
        role="status"
        aria-live="polite"
        data-testid="rumination-status"
        data-state={ruminationActive ? 'active' : armed ? 'clear' : 'unarmed'}
      >
        {ruminationActive ? (
          <>
            <RefreshCcw size={18} className="shrink-0 text-rose-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="whitespace-nowrap text-[13px] font-medium text-rose-300">This may be going in circles</p>
              <p className="whitespace-nowrap text-[11.5px] leading-4 text-paper-300">Only a guess from the wording. Ignore it freely</p>
            </div>
            <button
              type="button"
              onClick={onStepBack}
              disabled={busy}
              className="shrink-0 rounded-lg bg-rose-400 px-2.5 py-1.5 text-[12.5px] font-medium text-ink-950 hover:bg-rose-300 disabled:opacity-50"
            >
              {busy ? <Loader size={13} className="animate-spin" /> : 'Step back'}
            </button>
            {onDismiss && (
              <button type="button" onClick={onDismiss} aria-label="Hide the step-back suggestion for this entry" title="Not now" className="shrink-0 rounded-lg p-1 text-paper-500 hover:bg-ink-900 hover:text-paper-100">
                <X size={14} />
              </button>
            )}
          </>
        ) : suggestionsOff ? (
          <>
            <CircleCheck size={18} className="shrink-0 text-paper-500" aria-hidden />
            <div>
              <p className="text-[13px] text-paper-100">Step-back suggestion off</p>
              <p className="text-[11.5px] text-paper-500">This guidance level waits to be asked</p>
            </div>
          </>
        ) : armed ? (
          <>
            <CircleCheck size={18} className="shrink-0 text-paper-500" aria-hidden />
            <div>
              <p className="text-[13px] text-paper-100">No looping pattern noticed</p>
              <p className="text-[11.5px] text-paper-500">Step-back suggestion on</p>
            </div>
          </>
        ) : (
          <>
            <div className="relative h-[18px] w-[18px] shrink-0" aria-hidden>
              <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] -rotate-90">
                <circle cx="10" cy="10" r="8" fill="none" stroke="#2c261f" strokeWidth="2.5" />
                <circle
                  cx="10"
                  cy="10"
                  r="8"
                  fill="none"
                  stroke="#93846f"
                  strokeWidth="2.5"
                  strokeDasharray={`${(Math.min(t.wordCount, thresholds.minWords) / thresholds.minWords) * 50.3} 50.3`}
                />
              </svg>
            </div>
            <div>
              <p className="text-[13px] text-paper-100">Warming up</p>
              <p className="nr-num text-[11.5px] text-paper-500">
                {t.wordCount} of {thresholds.minWords} words
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
