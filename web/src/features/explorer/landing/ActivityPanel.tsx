// The chain's long-range figures: a row of tiles (transactions, fees, FLUX moved, blocks, supply), each with its newest
// whole day, the change against the days before it and a sparkline; the one you choose is drawn big below, over 30 days,
// 90 days, a year or two years. The history comes from the server's daily figures; before its first fill the server says
// to wait, and the panel waits with it, in words, instead of showing an error.

import { ChartNoAxesCombined, History } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatCompact } from '../../../lib/format';
import { Delta, EmptyState, Freshness, SegmentedControl, Skeleton, Sparkline, Stat } from '../../../ui';
import { HubLink, HubPanel } from '../../hub';
import { formatDate } from '../../wallet/lib/dates';
import { ActivityChart } from './ActivityChart';
import { type DailyRange, isFilling, useChainDaily } from './api';
import {
  completeValues,
  DAILY_RANGES,
  dailySeries,
  drawnSeries,
  hasData,
  headline,
  legacyMining,
  legacyNote,
  METRIC_IDS,
  METRICS,
  type MetricId,
  rangePhrase,
  resolveScale,
  type ScalePref,
  type SeriesFrame,
  thinValues,
} from './lib/daily';
import './activity.css';

const RANGE_OPTIONS = DAILY_RANGES.map((r) => ({ value: r.id, label: r.label }));
const SCALE_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'log', label: 'Log' },
] as const;

function Tile({
  frame,
  selected,
  onSelect,
}: {
  frame: SeriesFrame;
  selected: boolean;
  onSelect: () => void;
}) {
  const info = METRICS[frame.metric];
  const h = useMemo(() => headline(frame), [frame]);
  const spark = useMemo(() => thinValues(completeValues(frame), 36), [frame]);
  const change = h.change;
  return (
    <Stat
      className="ex-act__tile"
      aria-pressed={selected}
      label={info.label}
      value={h.value === null ? null : info.short(h.value)}
      unit={info.unit}
      delta={
        change && change.kind === 'percent' ? (
          <Delta kind="percent" decimals={1} value={change.value} period="vs prior 7 days" />
        ) : undefined
      }
      caption={
        h.value === null
          ? undefined
          : change && change.kind === 'amount'
            ? `${change.value >= 0 ? '+' : '-'}${formatCompact(Math.abs(change.value))} in ${change.period}`
            : h.at === null
              ? undefined
              : info.kind === 'flow'
                ? `${formatDate(h.at)}, a whole day`
                : `on ${formatDate(h.at)}`
      }
      spark={<Sparkline values={spark} form="area" label={`${info.label} over the range`} />}
      onClick={onSelect}
    />
  );
}

function ActivitySkeleton({ waiting }: { waiting: boolean }) {
  return (
    <div className="ex-act__skeleton" aria-hidden={waiting ? undefined : true}>
      <div className="ex-act__tiles" aria-hidden="true">
        {METRIC_IDS.map((id) => (
          <Stat key={id} label={METRICS[id].label} loading />
        ))}
      </div>
      <Skeleton h={252} radius={10} />
      {waiting ? (
        <p className="ex-act__wait" role="status">
          <History size={14} strokeWidth={1.5} aria-hidden="true" />
          The server is reading the chain's history for the first time. It takes about half a minute, and the
          charts appear on their own.
        </p>
      ) : null}
    </div>
  );
}

export function ActivityPanel() {
  const [range, setRange] = useState<DailyRange>('365');
  const [metric, setMetric] = useState<MetricId>('transactions');
  const [prefs, setPrefs] = useState<Partial<Record<MetricId, ScalePref>>>({});
  const q = useChainDaily(range);
  const dto = q.data;

  const frames = useMemo(() => {
    if (!dto) return null;
    const out = {} as Record<MetricId, SeriesFrame>;
    for (const id of METRIC_IDS) out[id] = dailySeries(dto, id);
    return out;
  }, [dto]);

  const frame = frames?.[metric] ?? null;
  const drawn = useMemo(() => (frame ? drawnSeries(frame) : null), [frame]);
  const pref = prefs[metric] ?? 'auto';
  const scale = drawn ? resolveScale(drawn, pref) : 'linear';
  const canLog = !!drawn && METRICS[metric].logAuto && resolveScale(drawn, 'log') === 'log';
  const legacy = useMemo(() => (dto ? legacyMining(dto) : null), [dto]);

  const waiting = q.isPending && isFilling(q.failureReason);
  const state = dto ? (dto.days.length === 0 ? 'empty' : 'ready') : q.isPending ? 'loading' : 'error';

  return (
    <HubPanel
      id="ex-activity"
      span="full"
      title="Chain activity"
      icon={ChartNoAxesCombined}
      aside={dto ? <Freshness label="figures" ts={dto.generated_ms} cadenceMs={12 * 3_600_000} /> : undefined}
      actions={
        <SegmentedControl
          size="sm"
          aria-label="Range"
          options={RANGE_OPTIONS}
          value={range}
          onChange={setRange}
        />
      }
      state={state}
      skeleton={<ActivitySkeleton waiting={waiting} />}
      error={q.error}
      onRetry={() => void q.refetch()}
      retrying={q.isFetching}
      errorTitle={
        isFilling(q.error) ? 'The history is still being read' : 'Could not load the chain activity'
      }
      errorText={
        isFilling(q.error)
          ? 'The server is reading the chain for the first time; try again in a moment.'
          : 'The daily figures come from the chain explorer through this server; try again in a moment.'
      }
      emptyIcon={ChartNoAxesCombined}
      emptyTitle="No daily figures yet"
      emptyText="The server has not read any days from the chain explorer."
      footer={
        <>
          <HubLink to={{ type: 'analytics', key: 'chain' }}>Open in analytics</HubLink>
          {state === 'ready' ? (
            <span className="ex-foot-note">
              {`Whole UTC days, ${rangePhrase(range)}. The day still running is shown lighter.`}
            </span>
          ) : null}
        </>
      }
    >
      {frames && drawn ? (
        <div
          className="ex-act"
          data-stale={q.isPlaceholderData || undefined}
          aria-busy={q.isPlaceholderData || undefined}
        >
          <fieldset className="ex-act__tiles">
            <legend className="ui-sr-only">Choose a figure to draw</legend>
            {METRIC_IDS.map((id) => (
              <Tile key={id} frame={frames[id]} selected={id === metric} onSelect={() => setMetric(id)} />
            ))}
          </fieldset>

          <div className="ex-act__bar">
            <h3 className="ex-act__title">{METRICS[metric].title}</h3>
            {canLog ? (
              <SegmentedControl
                size="sm"
                aria-label="Scale"
                options={SCALE_OPTIONS}
                value={scale}
                onChange={(next) => setPrefs((p) => ({ ...p, [metric]: next }))}
              />
            ) : null}
          </div>

          {hasData(drawn) ? (
            <ActivityChart frame={drawn} scale={scale} range={range} />
          ) : (
            <EmptyState compact icon={ChartNoAxesCombined} title="Nothing to draw">
              {`The server has no ${METRICS[metric].label.toLowerCase()} figures for ${rangePhrase(range)}.`}
            </EmptyState>
          )}

          <details className="ex-act__legacy">
            <summary>Why there is no difficulty or hash rate</summary>
            <p>{legacyNote(legacy)}</p>
          </details>
        </div>
      ) : null}
    </HubPanel>
  );
}
