// The emission schedule as instruments: the block subsidy as a staircase with every cut on it, the
// supply that schedule projects against the announced 560M, and the dev fund's inflow. Dates are
// estimates (30 second blocks from the tip) and every chart says so.

import { TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatInt, formatSats, formatUtcDateTime } from '../../../../lib/format';
import { TimeChart } from '../../../analytics/viz/TimeChart';
import {
  ANNOUNCED_MAX_SUPPLY_FLUX,
  allCuts,
  BLOCK_MS,
  estimateTimeMs,
  FIRST_REDUCTION_HEIGHT,
  heightReachingSupply,
  MAX_REDUCTIONS,
  projectEmission,
  REDUCTION_INTERVAL,
  reductionHeight,
  satsToFlux,
  subsidyAt,
} from '../../lib/emission';
import { Section, Segmented, type SegmentedItem } from '../../parts';
import './supply.css';

interface Tip {
  height: number;
  timeMs: number;
}

const horizonHeight = () => reductionHeight(MAX_REDUCTIONS) + REDUCTION_INTERVAL;

function xFormat(tip: Tip) {
  return (t: number) => {
    const h = Math.round(tip.height + (t - tip.timeMs) / BLOCK_MS);
    return `${formatUtcDateTime(t).slice(0, 10)}, block ${formatInt(h)}`;
  };
}

export function SubsidyChart({ tip }: { tip: Tip }) {
  const data = useMemo(() => {
    const cuts = allCuts();
    const pts = [{ h: tip.height, v: satsToFlux(subsidyAt(tip.height) ?? 0n) }];
    for (const c of cuts) if (c.height > tip.height) pts.push({ h: c.height, v: satsToFlux(c.subsidy) });
    pts.push({ h: horizonHeight(), v: pts.at(-1)!.v });
    return { t: pts.map((p) => estimateTimeMs(p.h, tip)), v: pts.map((p) => p.v) };
  }, [tip]);
  return (
    <TimeChart
      title="Block subsidy"
      summary="The reward per block in FLUX, which falls by 10 percent every 1,051,200 blocks, 20 times"
      t={data.t}
      series={[
        { key: 'subsidy', label: 'Subsidy per block', color: 'var(--viz-1)', values: data.v, fill: true },
      ]}
      mode="step"
      height={230}
      yMin={0}
      yFormat={(v) => `${v.toFixed(2)} FLUX`}
      yTickFormat={(v) => v.toFixed(0)}
      xFormat={xFormat(tip)}
      marks={[
        { kind: 'v', at: estimateTimeMs(FIRST_REDUCTION_HEIGHT, tip), label: 'first cut', tone: 'accent' },
      ]}
      unit="FLUX"
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
      <TimeChart
        title="Projected supply"
        summary="The total supply if every block pays the scheduled subsidy and nothing else changes, against the announced 560 million"
        t={data.t}
        series={[
          { key: 'supply', label: 'Projected supply', color: 'var(--viz-1)', values: data.v, fill: true },
        ]}
        height={240}
        yMin="auto"
        yFormat={(v) => `${formatInt(Math.round(v))} FLUX`}
        xFormat={xFormat(tip)}
        marks={[
          { kind: 'h', at: ANNOUNCED_MAX_SUPPLY_FLUX, label: '560M announced, not enforced', tone: 'warn' },
        ]}
        unit="FLUX"
      />
      {reach !== null ? (
        <p className="ex-note">
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
    <TimeChart
      title="Dev fund inflow"
      summary="FLUX the dev fund receives from today at its fixed share of each block, not counting transaction fees"
      t={data.t}
      series={[{ key: 'dev', label: 'Cumulative inflow', color: 'var(--viz-1)', values: data.v, fill: true }]}
      height={200}
      yMin={0}
      yFormat={(v) => `${formatInt(Math.round(v))} FLUX`}
      xFormat={xFormat(tip)}
      unit="FLUX"
    />
  );
}

type EmissionView = 'subsidy' | 'supply';

const EMISSION_VIEWS: readonly SegmentedItem<EmissionView>[] = [
  { id: 'subsidy', label: 'Block subsidy', hint: 'The reward per block, with every cut' },
  { id: 'supply', label: 'Projected supply', hint: 'Total supply against the announced 560M' },
];

/** The one chart on the supply page: the schedule as a staircase, or what it adds up to. */
export function EmissionSection({ tip, supplyFlux }: { tip: Tip; supplyFlux: number }) {
  const [view, setView] = useState<EmissionView>('subsidy');
  return (
    <Section
      title="Emission schedule"
      icon={TrendingUp}
      aside="dates are estimates"
      actions={<Segmented items={EMISSION_VIEWS} value={view} onChange={setView} label="What to chart" />}
    >
      {view === 'subsidy' ? <SubsidyChart tip={tip} /> : <SupplyChart tip={tip} supplyFlux={supplyFlux} />}
    </Section>
  );
}

/** Every cut as a table: block, estimated date, subsidy and what each tier and the dev fund are paid. */
export function CutSchedule({ tip }: { tip: Tip }) {
  const cuts = useMemo(() => allCuts(), []);
  return (
    <Section
      title="Every cut"
      collapsible
      defaultOpen={false}
      aside={`${MAX_REDUCTIONS} cuts, one every ${formatInt(REDUCTION_INTERVAL)} blocks`}
    >
      <div className="ex-tablewrap" tabIndex={-1}>
        <table className="ex-table">
          <caption className="ex-sr">Reward cut schedule</caption>
          <thead>
            <tr>
              <th scope="col">Cut</th>
              <th scope="col">Block</th>
              <th scope="col">Around</th>
              <th scope="col">Subsidy</th>
              <th scope="col">Stratus</th>
              <th scope="col">Nimbus</th>
              <th scope="col">Cumulus</th>
              <th scope="col">Dev fund at least</th>
            </tr>
          </thead>
          <tbody>
            {cuts.map((c) => {
              const past = c.height <= tip.height;
              const next = !past && cuts.find((x) => x.height > tip.height)?.k === c.k;
              return (
                <tr key={c.k} data-past={past || undefined} data-next={next || undefined}>
                  <th scope="row">{c.k}</th>
                  <td>{formatInt(c.height)}</td>
                  <td>{formatUtcDateTime(estimateTimeMs(c.height, tip)).slice(0, 10)}</td>
                  <td>{formatSats(c.subsidy, { decimals: 3, unit: false })}</td>
                  <td>{formatSats(c.schedule.stratus, { decimals: 3, unit: false })}</td>
                  <td>{formatSats(c.schedule.nimbus, { decimals: 3, unit: false })}</td>
                  <td>{formatSats(c.schedule.cumulus, { decimals: 3, unit: false })}</td>
                  <td>{formatSats(c.schedule.devFundMin, { decimals: 3, unit: false })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
