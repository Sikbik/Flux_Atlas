// How the nodes benchmark, tier by tier: for the metric you pick, a bar from the 10th to the 90th percentile of the
// tier's nodes with the median ticked, against a line for the minimum the tier asks for, all on one scale so the tiers
// can be compared by eye. The same numbers are written out beside each bar, so the picture is never the only way to
// read them. It reads the nodes overview and owns its own states.

import { Gauge } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { BenchMetric } from '../../../api/generated/BenchMetric';
import { Freshness, TabPanel, Tabs, TierGlyph } from '../../../ui';
import { HubPanel, isFilling, type PanelState, useNodesOverview } from '..';
import { type BenchModel, benchModel, benchNumber, METRICS, presentMetrics } from './lib/benchmarks';
import { ghostBench } from './lib/placeholders';
import { Redact, WaitAside } from './Redact';
import './bench.css';

/** The graphic and its numbers for one metric. */
function Chart({ model }: { model: BenchModel }) {
  const unit = model.meta.unit;
  return (
    <div className="nd-bench">
      <div className="nd-bench__head" aria-hidden="true">
        <span />
        <span className="nd-bench__unit">
          {model.meta.label}, in {unit}
        </span>
        <span>10th</span>
        <span>Median</span>
        <span>90th</span>
        <span>Minimum</span>
      </div>
      <ul className="nd-bench__rows" aria-label={`${model.meta.label} by tier`}>
        {model.rows.map((r) => (
          <li key={r.tier} className="nd-br" data-tier={r.tier}>
            <span className="nd-br__tier">
              <TierGlyph tier={r.tier} size={16} />
              {r.name}
            </span>
            <span className="nd-br__plot" aria-hidden="true">
              {model.ticks.slice(1, -1).map((t) => (
                <i key={t.at} className="nd-br__grid" style={{ left: `${t.at * 100}%` }} />
              ))}
              <i
                className="nd-br__range"
                style={{ left: `${r.x10 * 100}%`, width: `${Math.max(0.6, (r.x90 - r.x10) * 100)}%` }}
              />
              <i className="nd-br__med" style={{ left: `${r.x50 * 100}%` }} />
              {r.xMin !== null ? <i className="nd-br__min" style={{ left: `${r.xMin * 100}%` }} /> : null}
            </span>
            <span className="nd-br__n" data-col="p10">
              <span className="ui-sr-only">10th percentile: </span>
              <small aria-hidden="true">10th</small>
              {benchNumber(r.p10)}
            </span>
            <span className="nd-br__n" data-col="p50" data-strong="">
              <span className="ui-sr-only">Median: </span>
              <small aria-hidden="true">Median</small>
              {benchNumber(r.p50)}
            </span>
            <span className="nd-br__n" data-col="p90">
              <span className="ui-sr-only">90th percentile: </span>
              <small aria-hidden="true">90th</small>
              {benchNumber(r.p90)}
            </span>
            <span className="nd-br__n" data-col="min">
              <span className="ui-sr-only">Tier minimum: </span>
              <small aria-hidden="true">Minimum</small>
              {r.minimum === null ? <span className="ui-unknown">None</span> : benchNumber(r.minimum)}
            </span>
          </li>
        ))}
      </ul>
      <div className="nd-bench__axis" aria-hidden="true">
        <span />
        <span className="nd-bench__ticks">
          {model.ticks.map((t) => (
            <span
              key={t.at}
              style={{ left: `${t.at * 100}%` }}
              data-edge={t.at === 0 ? 'start' : t.at === 1 ? 'end' : undefined}
            >
              {t.text}
            </span>
          ))}
        </span>
      </div>
      <ul className="nd-bench__key" aria-label="How to read the bars">
        <li>
          <i data-key="range" aria-hidden="true" />
          10th to 90th percentile of the tier's nodes
        </li>
        <li>
          <i data-key="median" aria-hidden="true" />
          median
        </li>
        <li>
          <i data-key="min" aria-hidden="true" />
          tier minimum
        </li>
      </ul>
      {model.reading ? <p className="nd-bench__reading">{model.reading}</p> : null}
    </div>
  );
}

/** Every tab the server can send, for the loading state. */
const GHOST_TABS = METRICS.map((m) => ({ id: m.id, label: m.tab }));
const GHOST = ghostBench();

export function BenchmarksPanel() {
  const q = useNodesOverview();
  const tabsId = useId();
  const [chosen, setChosen] = useState<BenchMetric>('eps');
  const metrics = useMemo(() => presentMetrics(q.data?.benchmarks), [q.data]);
  // The chosen metric, or the first one the server sent when the chosen one is not among them.
  const metric = metrics.find((m) => m.id === chosen)?.id ?? metrics[0]?.id ?? chosen;
  const model = useMemo(() => benchModel(q.data?.benchmarks, metric), [q.data, metric]);

  // Loading is the ready state with made-up numbers, so the footer is there and the panel does not grow.
  const loading = q.isPending;
  const waiting = loading && isFilling(q.failureReason);
  const filling = isFilling(q.error);
  const state: PanelState = q.data ? (metrics.length === 0 ? 'empty' : 'ready') : loading ? 'ready' : 'error';

  return (
    <HubPanel
      id="nd-bench"
      span="full"
      title="How nodes benchmark"
      icon={Gauge}
      aside={
        q.data ? (
          <Freshness label="benchmarks" ts={q.data.generated_ms} cadenceMs={90_000} />
        ) : loading ? (
          waiting ? (
            <WaitAside what="The benchmarks" />
          ) : (
            <span className="nd-aside-ghost" aria-hidden="true" />
          )
        ) : undefined
      }
      state={state}
      aria-busy={loading || undefined}
      error={q.error}
      onRetry={() => void q.refetch()}
      retrying={q.isFetching}
      errorTitle={filling ? 'The benchmarks are still being read' : 'Could not load the benchmarks'}
      errorText={
        filling
          ? 'The server is reading the chain tip for the first time; try again in a moment.'
          : "They are computed by this server from each node's own benchmark; try again in a moment."
      }
      emptyIcon={Gauge}
      emptyTitle="No benchmarks yet"
      emptyText="No confirmed node has reported a benchmark."
      footer={
        <span className="nd-foot-note">
          Measured by each node&apos;s own benchmark tool and reported to the network
        </span>
      }
    >
      {loading && GHOST ? (
        <Redact>
          <div className="nd-benchwrap">
            <Tabs
              size="sm"
              id={`${tabsId}-ghost`}
              aria-label="Benchmark"
              items={GHOST_TABS}
              value="eps"
              onChange={() => undefined}
            />
            <Chart model={GHOST} />
          </div>
        </Redact>
      ) : model ? (
        <div className="nd-benchwrap">
          <Tabs
            size="sm"
            id={tabsId}
            aria-label="Benchmark"
            items={metrics.map((m) => ({ id: m.id, label: m.tab }))}
            value={metric}
            onChange={setChosen}
          />
          <TabPanel id={metric} value={metric} tabsId={tabsId}>
            <Chart model={model} />
          </TabPanel>
        </div>
      ) : null}
    </HubPanel>
  );
}
