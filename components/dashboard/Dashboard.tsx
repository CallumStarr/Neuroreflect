'use client';

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDB } from '@/lib/db';
import { useUI } from '@/lib/store';
import { addDays, formatDay, localDayOf } from '@/lib/util';
import { CHART } from '@/lib/chart-theme';
import {
  CalibrationDumbbell,
  ChartPanel,
  DataTable,
  EmptyChart,
  ErrorColumns,
  LanguageLines,
  LegendItem,
  TrendLine,
  ValuesBars,
  type CalibrationRow,
  type ErrorPoint,
  type LanguagePoint,
  type TrendPoint,
  type ValueRow,
} from './charts';

type Range = '14' | '30' | '90' | 'all';
const RANGES: { id: Range; label: string }[] = [
  { id: '14', label: 'Last 14 days' },
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
  { id: 'all', label: 'All time' },
];

const short = (day: string) => formatDay(day, { day: 'numeric', month: 'short' });

function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="px-5 py-1">
      <p className="text-[12.5px] text-paper-500">{label}</p>
      <p className="mt-1 text-[26px] font-semibold leading-8 text-paper-50">{value}</p>
      {note && <p className="text-[12px] text-paper-500">{note}</p>}
    </div>
  );
}

export default function Dashboard() {
  const { settings, openEntry } = useUI();
  const [range, setRange] = useState<Range>('all');
  const data = useLiveQuery(async () => {
    const db = getDB();
    const [entries, telemetry, forecasts, values, alignments] = await Promise.all([
      db.entries.toArray(),
      db.telemetry.toArray(),
      db.forecasts.toArray(),
      db.coreValues.orderBy('order').toArray(),
      db.valueAlignments.toArray(),
    ]);
    return { entries, telemetry, forecasts, values, alignments };
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const since = range === 'all' ? '0000-00-00' : addDays(localDayOf(), -Number(range));
    const entries = data.entries.filter((e) => e.localDay >= since && e.wordCount > 0);
    const byId = new Map(entries.map((e) => [e.id, e]));
    const tele = data.telemetry
      .filter((t) => byId.has(t.entryId))
      .sort((a, b) => (a.localDay === b.localDay ? byId.get(a.entryId)!.createdAt.localeCompare(byId.get(b.entryId)!.createdAt) : a.localDay.localeCompare(b.localDay)));
    const titleOf = (id: string) => byId.get(id)?.title || 'Untitled';

    const forecasts = data.forecasts.filter((f) => f.targetDate >= since).sort((a, b) => a.targetDate.localeCompare(b.targetDate));
    const checked = forecasts.filter((f) => f.actualImpact !== null);
    const meanError = checked.length ? checked.reduce((s, f) => s + (f.predictedDread - (f.actualImpact ?? 0)), 0) / checked.length : null;

    const calibrationRows: CalibrationRow[] = forecasts.map((f) => ({
      id: f.id,
      label: f.eventName,
      date: formatDay(f.targetDate),
      predicted: f.predictedDread,
      actual: f.actualImpact,
      predictedCoping: f.predictedCoping,
      actualCoping: f.actualCoping,
      worstCase: f.worstCase,
    }));
    const errorPoints: ErrorPoint[] = checked.map((f) => ({ label: short(f.targetDate), event: f.eventName, delta: f.predictedDread - (f.actualImpact ?? 0) }));

    const granularity: TrendPoint[] = tele.map((t) => ({ label: short(t.localDay), value: t.granularityIndex, title: titleOf(t.entryId) }));
    const defusion: TrendPoint[] = tele.map((t) => ({ label: short(t.localDay), value: t.fusionScore, title: titleOf(t.entryId) }));
    const language: LanguagePoint[] = tele.map((t) => ({ label: short(t.localDay), title: titleOf(t.entryId), self: t.iTalkDensity * 100, sense: t.cogProcDensity * 100 }));

    const valueRows: ValueRow[] = data.values.map((v) => {
      const rows = data.alignments.filter((a) => a.valueId === v.id && byId.has(a.entryId) && !a.evidence.startsWith('Not mentioned'));
      return { label: v.label, mentions: rows.length, average: rows.length ? rows.reduce((s, a) => s + a.score, 0) / rows.length : 0 };
    });

    const words = entries.reduce((s, e) => s + e.wordCount, 0);
    const loops = tele.filter((t) => t.ruminationFlag);
    const avgGran = tele.length ? tele.reduce((s, t) => s + t.granularityIndex, 0) / tele.length : 0;
    return { entries, tele, forecasts, checked, meanError, calibrationRows, errorPoints, granularity, defusion, language, valueRows, words, loops, avgGran, titleOf };
  }, [data, range]);

  if (!view) return null;
  const hasTelemetry = view.tele.length > 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1160px] px-10 pb-16 pt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-serif text-[1.9rem] text-paper-50" style={{ fontVariationSettings: "'opsz' 36" }}>
            Patterns in your writing
          </h1>
          <div role="radiogroup" aria-label="Time range" className="flex rounded-lg border border-ink-800 p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={range === r.id}
                onClick={() => setRange(r.id)}
                className={`rounded-md px-3 py-1.5 text-[12.5px] ${range === r.id ? 'bg-ink-850 text-paper-50' : 'text-paper-500 hover:text-paper-100'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-2 max-w-[70ch] text-[13px] leading-6 text-paper-500">
          These measure the words you write, not you. They are not a test or a diagnosis, and the same day can read very differently depending on what you chose to write about.
        </p>

        {/* Hero: the impact-bias number, the one figure this view leads with. */}
        <section className="mt-8 grid grid-cols-1 items-end gap-8 border-b border-ink-800 pb-8 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <p className="text-[13px] text-paper-300">Average forecast error</p>
            {view.meanError !== null ? (
              <>
                <p className="mt-1 text-[64px] font-semibold leading-none tracking-tight text-paper-50" data-testid="hero-error">
                  {view.meanError > 0 ? '+' : ''}
                  {view.meanError.toFixed(0)}
                </p>
                <p className="mt-3 max-w-[38ch] text-[13.5px] leading-6 text-paper-300">
                  {view.meanError > 0
                    ? `Across ${view.checked.length} checked ${view.checked.length === 1 ? 'forecast' : 'forecasts'}, events felt ${view.meanError.toFixed(0)} points less bad than you predicted, on a 0 to 100 dread scale.`
                    : view.meanError < 0
                      ? `Across ${view.checked.length} checked forecasts, events felt ${Math.abs(view.meanError).toFixed(0)} points worse than you predicted.`
                      : 'Your forecasts have matched reality on average.'}
                </p>
              </>
            ) : (
              <p className="mt-2 max-w-[40ch] text-[13.5px] leading-6 text-paper-500">
                No checked forecasts in this range yet. Use Forecast in the journal before an event you are dreading; you will be asked how it really went afterwards.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 divide-x divide-ink-800 sm:grid-cols-4">
            <StatTile label="Entries" value={String(view.entries.length)} />
            <StatTile label="Words written" value={view.words.toLocaleString('en-GB')} />
            <StatTile label="Circling entries" value={String(view.loops.length)} note={`of ${view.tele.length} scored entries`} />
            <StatTile label="Average granularity" value={view.avgGran.toFixed(1)} note="precise words per 1,000" />
          </div>
        </section>

        <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[3fr_2fr]">
          <ChartPanel
            title="Forecast calibration"
            description="For each event you forecast, the dread you predicted and the impact you reported afterwards. The gap is your brain's impact bias."
            legend={
              <>
                <LegendItem color={CHART.warm} label="Predicted dread" />
                <LegendItem color={CHART.cool} label="Actual impact" />
              </>
            }
            table={
              <DataTable
                columns={['Event', 'Date', 'Predicted dread', 'Actual impact', 'Error', 'Predicted coping', 'Actual coping']}
                rows={view.forecasts.map((f) => [
                  f.eventName,
                  formatDay(f.targetDate),
                  f.predictedDread,
                  f.actualImpact ?? 'not checked',
                  f.actualImpact === null ? '' : f.predictedDread - f.actualImpact,
                  f.predictedCoping,
                  f.actualCoping ?? '',
                ])}
              />
            }
          >
            {view.calibrationRows.length ? <CalibrationDumbbell rows={view.calibrationRows} /> : <EmptyChart message="No forecasts in this range." />}
          </ChartPanel>

          <ChartPanel
            title="Forecast error over time"
            description="Predicted dread minus actual impact. Above zero means it was less bad than you feared."
            legend={
              <>
                <LegendItem color={CHART.warm} label="Overestimated" />
                <LegendItem color={CHART.cool} label="Underestimated" />
              </>
            }
            table={<DataTable columns={['Date', 'Event', 'Error']} rows={view.errorPoints.map((p) => [p.label, p.event, p.delta])} />}
          >
            {view.errorPoints.length ? <ErrorColumns data={view.errorPoints} mean={view.meanError ?? 0} /> : <EmptyChart message="Errors appear once a forecast has been checked against reality." />}
          </ChartPanel>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartPanel
            title="Precise feeling words"
            description="Distinct, precise feeling words per 1,000 words, per entry. Higher means you are naming feelings more precisely."
            table={<DataTable columns={['Date', 'Entry', 'Granularity']} rows={view.granularity.map((p) => [p.label, p.title, Number(p.value.toFixed(1))])} />}
          >
            {hasTelemetry ? <TrendLine data={view.granularity} unit="per 1,000 words" domain={[0, 40]} ticks={[0, 10, 20, 30, 40]} /> : <EmptyChart message="Write an entry to start the trend." />}
          </ChartPanel>
          <ChartPanel
            title="Distance from thoughts"
            description="Out of 100. Drops when you write absolute statements as if they were simply true; rises when you write thoughts as thoughts you noticed."
            table={<DataTable columns={['Date', 'Entry', 'Distance']} rows={view.defusion.map((p) => [p.label, p.title, p.value])} />}
          >
            {hasTelemetry ? <TrendLine data={view.defusion} unit="out of 100" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} digits={0} /> : <EmptyChart message="Write an entry to start the trend." />}
          </ChartPanel>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartPanel
            title="Self-focus and sense-making"
            description="Share of words that are I, me, my, against causal and insight words. Circling entries tend to show high self-focus with little sense-making."
            legend={
              <>
                <LegendItem color={CHART.warm} label="Self-focus" shape="line" />
                <LegendItem color={CHART.cool} label="Making sense" shape="line" />
              </>
            }
            table={<DataTable columns={['Date', 'Entry', 'Self-focus %', 'Making sense %']} rows={view.language.map((p) => [p.label, p.title, Number(p.self.toFixed(1)), Number(p.sense.toFixed(1))])} />}
          >
            {hasTelemetry ? <LanguageLines data={view.language} threshold={settings.thresholds.iTalk} /> : <EmptyChart message="Write an entry to start the trend." />}
          </ChartPanel>
          <ChartPanel
            title="Values and action"
            description="Average alignment per core value across entries that mention it, from drifting (-2) to acting on it (+2)."
            legend={
              <>
                <LegendItem color={CHART.warm} label="Drifting" />
                <LegendItem color={CHART.neutral} label="Neutral" />
                <LegendItem color={CHART.cool} label="Acting on it" />
              </>
            }
            table={<DataTable columns={['Value', 'Average', 'Entries mentioning']} rows={view.valueRows.map((r) => [r.label, Number(r.average.toFixed(2)), r.mentions])} />}
          >
            {view.valueRows.length ? <ValuesBars rows={view.valueRows} /> : <EmptyChart message="Add core values in the Vault to track alignment." />}
          </ChartPanel>
        </div>

        {view.loops.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[15px] font-medium text-paper-50">Entries where the circuit-breaker fired</h2>
            <ul className="mt-3 divide-y divide-ink-800 border-y border-ink-800">
              {view.loops.map((t) => (
                <li key={t.entryId}>
                  <button type="button" onClick={() => openEntry(t.entryId)} className="flex w-full items-center justify-between gap-4 py-3 text-left hover:bg-ink-900">
                    <span>
                      <span className="font-serif text-[15px] text-paper-100">{view.titleOf(t.entryId)}</span>
                      <span className="ml-3 text-[12.5px] text-paper-500">{formatDay(t.localDay)}</span>
                    </span>
                    <span className="nr-num text-[12.5px] text-paper-300">
                      self-focus {(t.iTalkDensity * 100).toFixed(1)}%, sense-making {(t.cogProcDensity * 100).toFixed(1)}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
