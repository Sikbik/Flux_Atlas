// The fleet's hardware against the network's nodes of the same tier, one row per measurement. Each row is a band: the
// network's middle 80% as a bar, its median as a tick, this fleet's median as a diamond and its weakest node as a dot,
// with the tier's minimum as a dashed line. The row says in words whether the weakest node clears the minimum, and the
// table under it holds the same numbers.

import { Cpu } from 'lucide-react';
import { type CSSProperties, useMemo, useState } from 'react';
import { formatInt } from '../../../../lib/format';
import { DataTable, type DataTableColumn, EmptyState, SegmentedControl, StatusChip } from '../../../../ui';
import { useWalletCtx } from '../../context';
import {
  type BandStatus,
  bandScale,
  bandSentence,
  bandStatus,
  METRIC_META,
  METRICS,
  medianStanding,
  metricValue,
} from '../../lib/health';
import { PAY_TIERS, type PayTier, type WalletBenchmark } from '../../types';
import { Panel } from '../../ui/Panel';

const TIER_WORD: Record<PayTier, string> = { cumulus: 'Cumulus', nimbus: 'Nimbus', stratus: 'Stratus' };

const STATUS: Record<BandStatus, { status: string; word: string }> = {
  ok: { status: 'confirmed', word: 'Clears the minimum' },
  near: { status: 'at-risk', word: 'Close to the minimum' },
  below: { status: 'error', word: 'Below the minimum' },
  untested: { status: 'unknown', word: 'No minimum set' },
};

const unitOf = (b: WalletBenchmark): string => METRIC_META[b.metric].unit;
const value = (n: number, b: WalletBenchmark): string => `${metricValue(n, b.metric)} ${unitOf(b)}`;

function Band({ b }: { b: WalletBenchmark }) {
  const meta = METRIC_META[b.metric];
  const { lo, hi } = bandScale(b);
  const at = (v: number): number => (hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0);
  const status = bandStatus(b);
  const standing = medianStanding(b);
  const st = STATUS[status];
  const range = { '--l': at(b.network.p10), '--w': at(b.network.p90) - at(b.network.p10) } as CSSProperties;
  const pos = (v: number) => ({ '--l': at(v) }) as CSSProperties;

  return (
    <li className="wl-band" data-status={status}>
      <span className="wl-band__name">{meta.label}</span>
      <span
        className="wl-band__track"
        aria-hidden="true"
        title={`Network: 10th percentile ${value(b.network.p10, b)}, median ${value(b.network.p50, b)}, 90th percentile ${value(b.network.p90, b)}. This fleet: median ${value(b.fleet_median, b)}, weakest ${value(b.fleet_min, b)}${b.minimum === null ? '' : `. Tier minimum ${value(b.minimum, b)}`}.`}
      >
        <i className="wl-band__range" style={range} />
        <i className="wl-band__p50" style={pos(b.network.p50)} />
        {b.minimum !== null ? <i className="wl-band__min" style={pos(b.minimum)} /> : null}
        <i className="wl-band__weak" style={pos(b.fleet_min)} />
        <i className="wl-band__median" style={pos(b.fleet_median)} />
      </span>
      <span className="wl-band__value">
        <b className="ui-mono">{metricValue(b.fleet_median, b.metric)}</b>
        <i>{meta.unit}</i>
        <em>
          {standing.side === 'level' || standing.ratio === null
            ? 'level with the network'
            : `${Math.abs(standing.ratio * 100).toFixed(0)}% ${standing.side} the network`}
        </em>
      </span>
      <span className="wl-band__status">
        <StatusChip status={st.status} label={st.word} size="sm" />
      </span>
      <span className="ui-sr-only">{bandSentence(b)}</span>
    </li>
  );
}

const COLUMNS: DataTableColumn<WalletBenchmark>[] = [
  {
    id: 'metric',
    header: 'Measurement',
    minWidth: 170,
    width: '1.6fr',
    cell: (b) => METRIC_META[b.metric].label,
  },
  { id: 'p10', header: 'Network 10th', numeric: true, minWidth: 104, cell: (b) => value(b.network.p10, b) },
  { id: 'p50', header: 'Network median', numeric: true, minWidth: 112, cell: (b) => value(b.network.p50, b) },
  { id: 'p90', header: 'Network 90th', numeric: true, minWidth: 104, cell: (b) => value(b.network.p90, b) },
  {
    id: 'median',
    header: 'Fleet median',
    numeric: true,
    minWidth: 108,
    cell: (b) => value(b.fleet_median, b),
  },
  { id: 'weak', header: 'Weakest node', numeric: true, minWidth: 108, cell: (b) => value(b.fleet_min, b) },
  {
    id: 'min',
    header: 'Tier minimum',
    numeric: true,
    minWidth: 104,
    cell: (b) => (b.minimum === null ? null : value(b.minimum, b)),
  },
  {
    id: 'nodes',
    header: 'Nodes measured',
    numeric: true,
    minWidth: 108,
    cell: (b) => formatInt(b.fleet_nodes),
  },
];

const rowKey = (b: WalletBenchmark): string => `${b.tier}:${b.metric}`;

export function Benchmarks() {
  const { dto } = useWalletCtx();
  const tiers = useMemo(() => {
    const present = new Set<string>(dto.benchmarks.map((b) => b.tier));
    return PAY_TIERS.filter((t) => present.has(t)).sort((a, b) => dto.tiers[b] - dto.tiers[a]);
  }, [dto.benchmarks, dto.tiers]);
  const [picked, setPicked] = useState<PayTier | null>(null);
  const tier = picked !== null && tiers.includes(picked) ? picked : (tiers[0] ?? null);

  const bands = useMemo(
    () =>
      dto.benchmarks
        .filter((b) => b.tier === tier)
        .sort((a, b) => METRICS.indexOf(a.metric) - METRICS.indexOf(b.metric)),
    [dto.benchmarks, tier],
  );

  if (tier === null || bands.length === 0) {
    return (
      <Panel title="Hardware against the network" icon={Cpu}>
        <EmptyState compact title="No benchmark results yet">
          A benchmark is a measurement FluxOS makes of a node's CPU, disk, memory and network. Atlas has not
          seen one for these nodes yet; it fills in as the network's nodes are read.
        </EmptyState>
      </Panel>
    );
  }

  const measured = Math.max(...bands.map((b) => b.fleet_nodes));
  const below = bands.filter((b) => bandStatus(b) === 'below').length;
  const near = bands.filter((b) => bandStatus(b) === 'near').length;

  return (
    <Panel
      title="Hardware against the network"
      icon={Cpu}
      aside={`${TIER_WORD[tier]}, ${formatInt(measured)} ${measured === 1 ? 'node' : 'nodes'} measured, against the confirmed nodes of that tier`}
      actions={
        tiers.length > 1 ? (
          <SegmentedControl
            size="sm"
            aria-label="Tier"
            value={tier}
            onChange={setPicked}
            options={tiers.map((t) => ({ value: t, label: `${TIER_WORD[t]} ${formatInt(dto.tiers[t])}` }))}
          />
        ) : undefined
      }
    >
      <p className="wl-note">
        {below > 0 ? (
          <>
            <b>
              {formatInt(below)} {below === 1 ? 'measurement is' : 'measurements are'} below the tier minimum
            </b>{' '}
            on at least one node, which fails the next benchmark.{' '}
          </>
        ) : near > 0 ? (
          <>
            <b>
              {formatInt(near)} {near === 1 ? 'measurement is' : 'measurements are'} within a tenth of the
              minimum
            </b>{' '}
            on at least one node. These vary from run to run, so a small dip can fail it.{' '}
          </>
        ) : (
          <>Every measurement of every node clears the tier minimum. </>
        )}
        The bar is where the middle 80% of the network's nodes sit.
      </p>
      <ul className="wl-bands" aria-label={`${TIER_WORD[tier]} hardware against the network`}>
        {bands.map((b) => (
          <Band key={rowKey(b)} b={b} />
        ))}
      </ul>
      <ul className="wl-bandkey" aria-hidden="true">
        <li>
          <i className="wl-bandkey__range" />
          Network, 10th to 90th percentile
        </li>
        <li>
          <i className="wl-bandkey__p50" />
          Network median
        </li>
        <li>
          <i className="wl-bandkey__median" />
          This fleet's median
        </li>
        <li>
          <i className="wl-bandkey__weak" />
          Its weakest node
        </li>
        <li>
          <i className="wl-bandkey__min" />
          Tier minimum
        </li>
      </ul>
      <details className="wl-data">
        <summary>Show the numbers</summary>
        <DataTable
          aria-label={`${TIER_WORD[tier]} hardware against the network, as a table`}
          rows={bands}
          columns={COLUMNS}
          rowKey={rowKey}
          zebra
        />
      </details>
    </Panel>
  );
}
