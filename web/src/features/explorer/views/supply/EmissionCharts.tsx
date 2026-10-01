// The emission schedule as instruments: the block subsidy as a staircase with every cut on it, the
// supply that schedule projects against the announced 560M, and the dev fund's inflow. Dates are
// estimates (30 second blocks from the tip) and every chart says so.

import { TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatCompact, formatInt, formatSats, formatUtcDateTime } from '../../../../lib/format';
import {
  DataTable,
  type DataTableColumn,
  Row,
  Section,
  SegmentedControl,
  Stack,
  TimeSeries,
} from '../../../../ui';
import {
  ANNOUNCED_MAX_SUPPLY_FLUX,
  allCuts,
  BLOCK_MS,
  type Cut,
  estimateTimeMs,
  heightReachingSupply,
  MAX_REDUCTIONS,
  projectEmission,
  REDUCTION_INTERVAL,
  reductionHeight,
  satsToFlux,
  subsidyAt,
} from '../../lib/emission';

interface Tip {
  height: number;
  timeMs: number;
}

const horizonHeight = () => reductionHeight(MAX_REDUCTIONS) + REDUCTION_INTERVAL;

/** A staircase needs the old value held up to the step: the new value starts a second later. */
const STEP_MS = 1_000;

function xFormat(tip: Tip) {
  return (t: number) => {
    const h = Math.round(tip.height + (t - tip.timeMs) / BLOCK_MS);
    return `${formatUtcDateTime(t).slice(0, 10)}, block ${formatInt(h)}`;
  };
}

export function SubsidyChart({ tip }: { tip: Tip }) {
  const data = useMemo(() => {
    const t: number[] = [tip.timeMs];
    const v: number[] = [satsToFlux(subsidyAt(tip.height) ?? 0n)];
    for (const c of allCuts()) {
      if (c.height <= tip.height) continue;
      const at = estimateTimeMs(c.height, tip);
      // Hold the old subsidy to the cut, then step to the new one.
      t.push(at - STEP_MS, at);
      v.push(v.at(-1) as number, satsToFlux(c.subsidy));
    }
    t.push(estimateTimeMs(horizonHeight(), tip));
    v.push(v.at(-1) as number);
    return { t, v };
  }, [tip]);
  return (
    <TimeSeries
      label="The reward per block in FLUX, which falls by 10 percent every 1,051,200 blocks, 20 times"
      t={data.t}
      series={[
        {
          key: 'subsidy',
          label: 'Subsidy per block',
          values: data.v,
          format: (v) => `${v.toFixed(2)} FLUX`,
        },
      ]}
      height={230}
      yDomain={[0, null]}
      yFormat={(v) => v.toFixed(0)}
      xFormat={xFormat(tip)}
    />
  );
}

export function SupplyChart({ tip, supplyFlux }: { tip: Tip; supplyFlux: number }) {
  const { data, reach } = useMemo(() => {
    const pts = projectEmission(tip.height, supplyFlux, horizonHeight() + REDUCTION_INTERVAL * 6, 260);
    const hr = heightReachingSupply(tip.height, supplyFlux, ANNOUNCED_MAX_SUPPLY_FLUX);
    return {
      data: { t: pts.map((p) => estimateTimeMs(p.height, tip)), v: pts.map((p) => p.supply) },
      reach: hr === null ? null : estimateTimeMs(hr, tip),
    };
  }, [tip, supplyFlux]);
  return (
    <>
      <TimeSeries
        label="The total supply if every block pays the scheduled subsidy and nothing else changes, against the announced 560 million"
        t={data.t}
        series={[
          {
            key: 'supply',
            label: 'Projected supply',
            values: data.v,
            format: (v) => `${formatInt(Math.round(v))} FLUX`,
          },
          {
            key: 'cap',
            label: '560M announced, not enforced',
            values: data.t.map(() => ANNOUNCED_MAX_SUPPLY_FLUX),
            format: (v) => `${formatInt(Math.round(v))} FLUX`,
          },
        ]}
        height={240}
        yFormat={(v) => formatCompact(v)}
        xFormat={xFormat(tip)}
      />
      {reach !== null ? (
        <p className="ex-caption">
          At the scheduled emission the supply passes 560 million around{' '}
          {formatUtcDateTime(reach).slice(0, 4)}. The consensus code has no cap: after the last cut the
          subsidy settles at {formatSats(subsidyAt(horizonHeight()) ?? 0n, { decimals: 2 })} per block and
          keeps emitting.
        </p>
      ) : null}
    </>
  );
}

export function DevFundChart({ tip, supplyFlux }: { tip: Tip; supplyFlux: number }) {
  const data = useMemo(() => {
    const pts = projectEmission(tip.height, supplyFlux, reductionHeight(MAX_REDUCTIONS), 200);
    return { t: pts.map((p) => estimateTimeMs(p.height, tip)), v: pts.map((p) => p.devFund) };
  }, [tip, supplyFlux]);
  return (
    <TimeSeries
      label="FLUX the dev fund receives from today at its fixed share of each block, not counting transaction fees"
      t={data.t}
      series={[
        {
          key: 'dev',
          label: 'Cumulative inflow',
          values: data.v,
          format: (v) => `${formatInt(Math.round(v))} FLUX`,
        },
      ]}
      height={200}
      yDomain={[0, null]}
      yFormat={(v) => formatCompact(v)}
      xFormat={xFormat(tip)}
    />
  );
}

type EmissionView = 'subsidy' | 'supply';

const EMISSION_VIEWS = [
  { value: 'subsidy', label: 'Block subsidy' },
  { value: 'supply', label: 'Projected supply' },
] as const;

/** The one chart on the supply page: the schedule as a staircase, or what it adds up to. */
export function EmissionSection({ tip, supplyFlux }: { tip: Tip; supplyFlux: number }) {
  const [view, setView] = useState<EmissionView>('subsidy');
  return (
    <Section title="Emission schedule" icon={TrendingUp}>
      <Stack gap={5}>
        <Row>
          <SegmentedControl
            size="sm"
            aria-label="What to chart"
            options={EMISSION_VIEWS}
            value={view}
            onChange={setView}
          />
        </Row>
        {view === 'subsidy' ? <SubsidyChart tip={tip} /> : <SupplyChart tip={tip} supplyFlux={supplyFlux} />}
        <p className="ex-caption">Dates are estimates: 30 second blocks counted forward from the tip.</p>
      </Stack>
    </Section>
  );
}

const money = (sats: bigint) => formatSats(sats, { decimals: 3, unit: false });

function cutColumns(tip: Tip): readonly DataTableColumn<Cut>[] {
  const next = allCuts().find((x) => x.height > tip.height)?.k;
  return [
    {
      id: 'k',
      header: 'Cut',
      width: 64,
      cell: (c) => (c.k === next ? `${c.k} (next)` : c.k),
    },
    { id: 'height', header: 'Block', numeric: true, minWidth: 110, cell: (c) => formatInt(c.height) },
    {
      id: 'when',
      header: 'Around',
      minWidth: 110,
      cell: (c) => formatUtcDateTime(estimateTimeMs(c.height, tip)).slice(0, 10),
    },
    { id: 'subsidy', header: 'Subsidy', numeric: true, minWidth: 100, cell: (c) => money(c.subsidy) },
    {
      id: 'stratus',
      header: 'Stratus',
      numeric: true,
      minWidth: 100,
      cell: (c) => money(c.schedule.stratus),
    },
    { id: 'nimbus', header: 'Nimbus', numeric: true, minWidth: 100, cell: (c) => money(c.schedule.nimbus) },
    {
      id: 'cumulus',
      header: 'Cumulus',
      numeric: true,
      minWidth: 100,
      cell: (c) => money(c.schedule.cumulus),
    },
    {
      id: 'dev',
      header: 'Dev fund at least',
      numeric: true,
      minWidth: 140,
      cell: (c) => money(c.schedule.devFundMin),
    },
  ];
}

/** Every cut as a table: block, estimated date, subsidy and what each tier and the dev fund are paid. */
export function CutSchedule({ tip }: { tip: Tip }) {
  const cuts = useMemo(() => allCuts(), []);
  const columns = useMemo(() => cutColumns(tip), [tip]);
  return (
    <Section title="Every cut" collapsible defaultOpen={false} flush>
      <p className="ex-note ex-pad">
        {MAX_REDUCTIONS} cuts, one every {formatInt(REDUCTION_INTERVAL)} blocks. Amounts are FLUX per block.
      </p>
      <DataTable
        aria-label="Reward cut schedule"
        rows={cuts}
        columns={columns}
        rowKey={(c) => c.k}
        rowHeight="compact"
        maxHeight={420}
      />
    </Section>
  );
}
