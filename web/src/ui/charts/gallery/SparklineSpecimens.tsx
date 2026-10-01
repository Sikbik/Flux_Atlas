import { useMemo, useState } from 'react';
import { useChainBlocks } from '../../../app/context';
import { formatInt, formatPercent } from '../../../lib/format';
import { Button } from '../../controls/Button';
import { SpecGrid, Specimen } from '../../gallery/primitives';
import { Sparkline } from '../Sparkline';
import { dense, lastN, trimGaps, useMetricData } from './chartData';
import './chartsGallery.css';

const NAMES = ['node_count', 'cumulus', 'nimbus', 'stratus', 'price_usd'] as const;

/** A small deterministic wiggle so the synthetic specimens look the same on every load. */
function synthetic(n: number, seed = 1): number[] {
  const out: number[] = [];
  let v = 50;
  let s = seed * 9301;
  for (let i = 0; i < n; i++) {
    s = (s * 49297 + 233280) % 233280;
    v += (s / 233280 - 0.5) * 12;
    out.push(Math.round(v * 10) / 10);
  }
  return out;
}

/** Block intervals in seconds and transactions per block, oldest first, from the live store. */
function useBlockSeries(n: number) {
  const blocks = useChainBlocks();
  return useMemo(() => {
    const asc = [...blocks].reverse();
    const intervals: number[] = [];
    for (let i = 1; i < asc.length; i++) {
      const a = asc[i];
      const b = asc[i - 1];
      if (a && b) intervals.push(Math.round(((a.timeMs - b.timeMs) / 1000) * 10) / 10);
    }
    return {
      intervals: lastN(intervals, n),
      txs: lastN(
        asc.map((b) => b.txCount),
        n,
      ),
    };
  }, [blocks, n]);
}

function Tile({
  label,
  value,
  unit,
  delta,
  dir,
  children,
}: {
  label: string;
  value: string;
  unit?: string;
  delta: string;
  dir?: 'up' | 'down';
  children: React.ReactNode;
}) {
  return (
    <div className="kgc-tile">
      <span className="kgc-tile__k">{label}</span>
      <span className="kgc-tile__v">
        {value}
        {unit ? <small>{unit}</small> : null}
      </span>
      <span className="kgc-tile__d" data-dir={dir}>
        {delta}
      </span>
      {children}
    </div>
  );
}

function LiveDraw() {
  const [shifting, setShifting] = useState<number[]>(() => synthetic(24, 3));
  const [growing, setGrowing] = useState<number[]>(() => synthetic(6, 5));
  const step = (s: number[]) => {
    const last = s[s.length - 1] ?? 50;
    return Math.round((last + (Math.random() - 0.45) * 14) * 10) / 10;
  };
  return (
    <div className="kgc-stack">
      <div className="kgc-controls">
        <Button size="sm" onClick={() => setShifting((s) => [...s.slice(1), step(s)])}>
          Push sample (window shifts)
        </Button>
        <Button size="sm" onClick={() => setGrowing((s) => [...s, step(s)])}>
          Push sample (series grows)
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setShifting(synthetic(24, 3));
            setGrowing(synthetic(6, 5));
          }}
        >
          Reset
        </Button>
      </div>
      <div className="kgc-row kgc-on-slab">
        <div className="kgc-cell">
          <Sparkline values={shifting} size="card" form="area" />
          <span>shift, {shifting.length} samples</span>
        </div>
        <div className="kgc-cell">
          <Sparkline values={growing} size="card" />
          <span>grow, {growing.length} samples</span>
        </div>
        <div className="kgc-cell">
          <Sparkline values={shifting} size="card" form="bars" />
          <span>bars, same samples</span>
        </div>
      </div>
    </div>
  );
}

/** Gallery specimens for Sparkline: forms, sizes, states, live draw, and the stat-tile placement. */
export function SparklineSpecimens() {
  const m = useMetricData(NAMES, '15m', ['price_usd']);
  // A trend glyph reads best with 12 to 30 samples: the last 6 hours (24 buckets) of the real series.
  const recent = (name: string) => lastN(dense(m.values[name] ?? []), 24);
  const nodes = recent('node_count');
  const cumulus = recent('cumulus');
  const nimbus = recent('nimbus');
  const stratus = recent('stratus');
  const price = trimGaps(m.values.price_usd ?? []);
  const blocks = useBlockSeries(24);

  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const change = first && last ? (last - first) / first : null;
  const gappy = m.values.node_count ?? [];

  return (
    <>
      <h3 className="kgc-group">
        Sparkline <small>a trend glyph: line, area or bars, an end dot that rides the line</small>
      </h3>
      <SpecGrid min={360}>
        <Specimen
          title="Forms at the card size (120 by 34)."
          caption={`Line, area, bars. Real data: the last ${nodes.length} node-count samples (15 min apart) from the live server; bars show transactions per block from the live store.`}
          surface="slab"
        >
          <div className="kgc-row kgc-on-slab">
            <div className="kgc-cell">
              <Sparkline values={nodes} size="card" />
              <span>line</span>
            </div>
            <div className="kgc-cell">
              <Sparkline values={nodes} size="card" form="area" />
              <span>area</span>
            </div>
            <div className="kgc-cell">
              <Sparkline values={blocks.txs} size="card" form="bars" />
              <span>bars, tx per block</span>
            </div>
          </div>
        </Specimen>

        <Specimen
          title="Forms at the tile size (64 by 26)."
          caption="The size the stat tile uses at its top right. The end dot is 8 px with a 2 px surface ring."
        >
          <div className="kgc-row kgc-on-slab">
            <div className="kgc-cell">
              <Sparkline values={nodes} />
              <span>line</span>
            </div>
            <div className="kgc-cell">
              <Sparkline values={nodes} form="area" />
              <span>area</span>
            </div>
            <div className="kgc-cell">
              <Sparkline values={blocks.txs} form="bars" />
              <span>bars</span>
            </div>
            <div className="kgc-cell">
              <Sparkline values={blocks.intervals} />
              <span>block interval</span>
            </div>
          </div>
        </Specimen>

        <Specimen
          title="Empty and edge states."
          caption="Flat (nothing changed) sits mid-height; no data is a dashed baseline, never a zero line; one sample is just the dot; null gaps break the line (synthetic samples)."
        >
          <div className="kgc-row kgc-on-slab">
            <div className="kgc-cell">
              <Sparkline values={[7, 7, 7, 7, 7, 7, 7, 7]} size="card" />
              <span>flat</span>
            </div>
            <div className="kgc-cell">
              <Sparkline values={[]} size="card" />
              <span>no data</span>
            </div>
            <div className="kgc-cell">
              <Sparkline values={[null, null, null]} size="card" form="area" />
              <span>all gaps</span>
            </div>
            <div className="kgc-cell">
              <Sparkline values={[null, null, 4]} size="card" />
              <span>one sample</span>
            </div>
            <div className="kgc-cell">
              <Sparkline values={[3, 5, 4, null, null, 6, 8, 7, null, 5, 6, 9]} size="card" />
              <span>null gaps</span>
            </div>
            <div className="kgc-cell">
              <Sparkline values={[3, 5, 4, null, 6, 8, 7, null, 5, 6, 9]} size="card" form="bars" />
              <span>gaps, bars</span>
            </div>
          </div>
        </Specimen>

        <Specimen
          title="Real gaps."
          caption="The same 24 h of node counts untrimmed: the server has no sample for some 15 minute buckets, so the line breaks there instead of inventing a value."
        >
          <div className="kgc-row kgc-on-slab">
            <div className="kgc-cell">
              <Sparkline values={gappy} size="card" />
              <span>{gappy.filter((v) => v === null).length} missing buckets</span>
            </div>
            <div className="kgc-cell">
              <Sparkline values={gappy} size="card" form="area" />
              <span>area</span>
            </div>
          </div>
        </Specimen>

        <Specimen
          title="Fluid width."
          caption="Fills its container and re-measures on resize. 420 px inspector, 820 px explorer, and a 160 px narrow cell."
          layout="stack"
        >
          <div className="kgc-stack kgc-on-slab">
            <div style={{ width: 'min(100%, 420px)' }}>
              <Sparkline values={nodes} width="fluid" height={44} form="area" />
            </div>
            <div style={{ width: 'min(100%, 820px)' }}>
              <Sparkline values={nodes} width="fluid" height={44} />
            </div>
            <div style={{ width: 160 }}>
              <Sparkline values={nodes} width="fluid" height={34} form="area" />
            </div>
          </div>
        </Specimen>

        <Specimen
          title="Colour follows the entity."
          caption="The tier counts use the tier ink colours (never the series palette); tier is also named in the label beside each."
        >
          <div className="kgc-row kgc-on-slab">
            <div className="kgc-cell">
              <Sparkline values={cumulus} size="card" color="var(--tier-cumulus-ink)" form="area" />
              <span>Cumulus</span>
            </div>
            <div className="kgc-cell">
              <Sparkline values={nimbus} size="card" color="var(--tier-nimbus-ink)" form="area" />
              <span>Nimbus</span>
            </div>
            <div className="kgc-cell">
              <Sparkline values={stratus} size="card" color="var(--tier-stratus-ink)" form="area" />
              <span>Stratus</span>
            </div>
            <div className="kgc-cell">
              <Sparkline values={price} size="card" color="var(--viz-3)" />
              <span>Price, {price.length} samples</span>
            </div>
          </div>
        </Specimen>

        <Specimen
          title="Live draw (design 6.4 E)."
          caption="Left and middle: synthetic samples you push by hand. The new segment slides in from the edge, the oldest sample leaves, the end dot rides the line and the y domain eases. Right: real block intervals from the store; a new block moves it."
          span={2}
        >
          <div className="kgc-stack">
            <LiveDraw />
            <div className="kgc-row kgc-on-slab">
              <div className="kgc-cell">
                <Sparkline values={blocks.intervals} size="card" form="area" />
                <span>live: seconds between the last {blocks.intervals.length} blocks</span>
              </div>
              <div className="kgc-cell">
                <Sparkline values={blocks.txs} size="card" form="bars" />
                <span>live: transactions per block</span>
              </div>
            </div>
          </div>
        </Specimen>

        <Specimen
          title="In a stat tile."
          caption="How the lead's Stat places it: 64 by 26 at the top right of an --ink-1 tile (stand-in markup, real values)."
          surface="void"
        >
          <div className="kgc-tiles">
            <Tile
              label="Nodes"
              value={formatInt(last)}
              delta={`${change !== null && change >= 0 ? '+' : ''}${formatPercent(change)} in 24 h`}
              dir={change !== null && change < 0 ? 'down' : 'up'}
            >
              <Sparkline values={nodes} />
            </Tile>
            <Tile label="Stratus nodes" value={formatInt(stratus[stratus.length - 1])} delta="24 h trend">
              <Sparkline values={stratus} form="area" color="var(--viz-1)" />
            </Tile>
            <Tile
              label="Tx per block"
              value={formatInt(blocks.txs[blocks.txs.length - 1])}
              delta="last 24 blocks"
            >
              <Sparkline values={blocks.txs} form="bars" />
            </Tile>
            <Tile label="Mempool" value="Unknown" delta="No data yet">
              <Sparkline values={[]} />
            </Tile>
          </div>
        </Specimen>
      </SpecGrid>
    </>
  );
}
