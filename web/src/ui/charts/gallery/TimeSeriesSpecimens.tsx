import { type ReactNode, useMemo, useState } from 'react';
import { ApiError } from '../../../api/http';
import { useChainBlocks } from '../../../app/context';
import { formatInt } from '../../../lib/format';
import { Button } from '../../controls/Button';
import { SpecGrid, Specimen } from '../../gallery/primitives';
import { TimeSeries, type TimeSeriesSeries } from '../TimeSeries';
import { dense, useMetricData } from './chartData';
import './chartsGallery.css';

/** A raised card with a heading, the way a window shows a chart. */
function ChartCard({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="kgc-card">
      <div className="kgc-card__head">
        <h4>{title}</h4>
        {aside ? <span>{aside}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** Deterministic wiggle for the synthetic specimens. */
function walk(n: number, start: number, step: number, seed: number): number[] {
  const out: number[] = [];
  let v = start;
  let s = seed * 7919;
  for (let i = 0; i < n; i++) {
    s = (s * 49297 + 233280) % 233280;
    v += (s / 233280 - 0.5) * step;
    out.push(Math.round(v * 10) / 10);
  }
  return out;
}

const NAMES = ['node_count', 'cumulus', 'nimbus', 'stratus'] as const;
const fmtInt = (v: number) => formatInt(v);

function SyntheticLive() {
  const [t, setT] = useState<number[]>(() => {
    const now = Date.now();
    return Array.from({ length: 24 }, (_, i) => now - (24 - i) * 30_000);
  });
  const [v, setV] = useState<number[]>(() => walk(24, 120, 8, 4));
  const push = (count: number) => {
    const now = Date.now();
    setT((prev) => {
      const last = prev[prev.length - 1] ?? now;
      return [...prev, ...Array.from({ length: count }, (_, i) => Math.max(now, last + 30_000) + i * 30_000)];
    });
    setV((prev) => {
      const out = [...prev];
      for (let i = 0; i < count; i++) {
        const last = out[out.length - 1] ?? 120;
        out.push(Math.round((last + (Math.random() - 0.48) * 14) * 10) / 10);
      }
      return out;
    });
  };
  const series = useMemo<TimeSeriesSeries[]>(
    () => [{ key: 'synthetic', label: 'Synthetic signal', values: v }],
    [v],
  );
  return (
    <ChartCard title="Synthetic stream" aside={`${v.length} points, window 60`}>
      <div className="kgc-controls">
        <Button size="sm" onClick={() => push(1)}>
          Add a point
        </Button>
        <Button size="sm" onClick={() => push(8)}>
          Add 8 points at once
        </Button>
      </div>
      <TimeSeries t={t} series={series} maxPoints={60} height={200} />
    </ChartCard>
  );
}

/** Gallery specimens for TimeSeries: single and multi series on real metrics, states, live append. */
export function TimeSeriesSpecimens() {
  const m = useMetricData(NAMES, '30m');
  const blocks = useChainBlocks();

  const nodes = useMemo<TimeSeriesSeries[]>(
    () => [{ key: 'node_count', label: 'Nodes', values: m.values.node_count ?? [] }],
    [m.values.node_count],
  );
  const tiers = useMemo<TimeSeriesSeries[]>(
    () => [
      { key: 'cumulus', label: 'Cumulus', values: m.values.cumulus ?? [], color: 'var(--tier-cumulus-ink)' },
      { key: 'nimbus', label: 'Nimbus', values: m.values.nimbus ?? [], color: 'var(--tier-nimbus-ink)' },
      { key: 'stratus', label: 'Stratus', values: m.values.stratus ?? [], color: 'var(--tier-stratus-ink)' },
    ],
    [m.values.cumulus, m.values.nimbus, m.values.stratus],
  );

  // The store's block ring, oldest first: real series that gain a point every 30 s.
  const ring = useMemo(() => {
    const asc = [...blocks].reverse();
    return {
      t: asc.map((b) => b.timeMs),
      txs: asc.map((b) => b.txCount),
      confirms: asc.map((b) => b.confirmCount),
      transfers: asc.map((b) => b.transferCount),
    };
  }, [blocks]);
  const kinds = useMemo<TimeSeriesSeries[]>(
    () => [
      { key: 'txs', label: 'Transactions', values: ring.txs },
      { key: 'confirms', label: 'Confirmations', values: ring.confirms },
      { key: 'transfers', label: 'Transfers', values: ring.transfers },
    ],
    [ring],
  );
  const liveTxs = useMemo<TimeSeriesSeries[]>(
    () => [{ key: 'txs', label: 'Transactions per block', values: ring.txs }],
    [ring.txs],
  );
  const tail = useMemo(
    () => ({
      t: ring.t.slice(-12),
      series: [{ key: 'txs', label: 'Transactions', values: ring.txs.slice(-12) }] as TimeSeriesSeries[],
    }),
    [ring],
  );

  const have = dense(m.values.node_count ?? []).length;

  return (
    <>
      <h3 className="kgc-group">
        TimeSeries{' '}
        <small>uPlot in its own lazy chunk; UTC time; hover, arrow keys, legend, "Show data"</small>
      </h3>
      <SpecGrid min={420}>
        <Specimen
          title="Single series on real data (explorer width, 820)."
          caption={`Node count over the last 24 h at 30 min: ${have} samples from the live server (it records about one row every 15 minutes). A gradient area under one hairline-grid line, an end dot with its ring; hover for the crosshair and tooltip, arrow keys to read points.`}
          surface="void"
          span={2}
          width={820}
        >
          <ChartCard title="Nodes" aside="24 h, 30 min">
            <TimeSeries t={m.t} series={nodes} loading={m.loading} error={m.error} yFormat={fmtInt} />
          </ChartCard>
        </Specimen>

        <Specimen
          title="Tier counts (inspector width, 420)."
          caption="Three series on one axis in the tier ink colours (never the series palette for tiers). The legend is real buttons: click isolates a tier, Shift-click shows or hides one. Tier is named in the legend and the tooltip, never colour alone."
          surface="void"
          width={420}
        >
          <ChartCard title="Nodes by tier" aside="24 h">
            <TimeSeries t={m.t} series={tiers} loading={m.loading} error={m.error} yFormat={fmtInt} />
          </ChartCard>
        </Specimen>

        <Specimen
          title="Categorical series (live store)."
          caption="Per block over the last 100 blocks: transactions, node confirmations and transfers. Slots follow array order (--viz-1, --viz-2, --viz-3) and never cycle."
          surface="void"
          width={420}
        >
          <ChartCard title="Per block, by kind" aside={`${ring.t.length} blocks`}>
            <TimeSeries t={ring.t} series={kinds} loading={ring.t.length === 0} yFormat={fmtInt} />
          </ChartCard>
        </Specimen>

        <Specimen
          title="Phone width (340)."
          caption="The same tier chart in a 340 px column: the legend wraps, ticks thin out, the tooltip flips to stay inside."
          surface="void"
          width={340}
        >
          <ChartCard title="Nodes by tier">
            <TimeSeries
              t={m.t}
              series={tiers}
              height={190}
              loading={m.loading}
              error={m.error}
              yFormat={fmtInt}
            />
          </ChartCard>
        </Specimen>

        <Specimen
          title="Show data open."
          caption="The accessible twin of the chart (design 10.3): the same numbers as a table, one row per point, Plex Mono, gaps as Unknown. The last 12 blocks here."
          surface="void"
          width={420}
        >
          <ChartCard title="Transactions per block" aside="last 12 blocks">
            <TimeSeries t={tail.t} series={tail.series} height={170} defaultShowData yFormat={fmtInt} />
          </ChartCard>
        </Specimen>

        <Specimen
          title="Loading, empty and error."
          caption="Loading is the chart's own geometry as a skeleton, no spinner. Empty is a dashed baseline and one sentence, never a zero line. Error says what happened and offers Retry."
          surface="void"
          layout="stack"
          width={420}
        >
          <ChartCard title="Loading">
            <TimeSeries t={[]} series={tiers} loading height={160} />
          </ChartCard>
          <ChartCard title="Empty">
            <TimeSeries
              t={[]}
              series={[{ key: 'x', label: 'x', values: [] }]}
              height={160}
              emptyText="Pick a wider range or check back after the next block."
            />
          </ChartCard>
          <ChartCard title="Error">
            <TimeSeries
              t={[]}
              series={[]}
              error={new ApiError('upstream', 'Flux API is behind', 502, '/api/v1/metrics')}
              onRetry={() => undefined}
              height={160}
            />
          </ChartCard>
        </Specimen>

        <Specimen
          title="Live append, real."
          caption="Transactions per block from the live store: every new block (about 30 s) arrives through setData on the same chart instance, batched in one frame, with the y domain easing. No timers: the store drives it."
          surface="void"
          width={420}
        >
          <ChartCard title="Transactions per block" aside={`${ring.t.length} blocks`}>
            <TimeSeries t={ring.t} series={liveTxs} height={200} yFormat={fmtInt} />
          </ChartCard>
        </Specimen>

        <Specimen
          title="Live append, synthetic."
          caption="Synthetic data you push by hand. Eight points at once still cost one redraw; the rolling window drops the oldest beyond 60."
          surface="void"
          width={420}
        >
          <SyntheticLive />
        </Specimen>
      </SpecGrid>
    </>
  );
}
