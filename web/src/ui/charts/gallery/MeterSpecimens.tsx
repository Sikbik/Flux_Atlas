import { useState } from 'react';
import { useNetworkCapacity } from '../../../api/queries';
import { useSummary, useTip } from '../../../app/context';
import { formatCompact, formatInt } from '../../../lib/format';
import { Button } from '../../controls/Button';
import { SpecGrid, Specimen } from '../../gallery/primitives';
import { Meter, type MeterZone } from '../Meter';
import './chartsGallery.css';

const ERA_START = 2_020_000;
const ERA_END = 3_071_200;

const CHECK_IN: MeterZone[] = [
  { from: 0, to: 60, tone: 'ok', label: 'Healthy' },
  { from: 60, to: 85, tone: 'warn', label: 'Due' },
  { from: 85, to: 100, tone: 'crit', label: 'At risk' },
];

/** Emission progress, locked capacity and a zoned check-in gauge: real readings, every size and state. */
export function MeterSpecimens() {
  const tip = useTip();
  const summary = useSummary();
  const capacity = useNetworkCapacity();
  const [age, setAge] = useState(42);
  const end = summary?.next_reduction_height ?? ERA_END;
  const cap = capacity.data;

  return (
    <>
      <h3 className="kgc-group">
        Meter <small>one reading in a range: a thin track, or a zoned gauge with a notch</small>
      </h3>
      <SpecGrid min={360}>
        <Specimen
          title="Emission era"
          caption="Real chain height between the era's first block and the next reduction; the labels are the two heights."
          surface="raised"
          layout="stack"
        >
          <Meter
            label="Emission era progress"
            value={tip?.height ?? null}
            min={ERA_START}
            max={end}
            startLabel={formatInt(ERA_START)}
            endLabel={formatInt(end)}
            showLabel
            showValue
            size="lg"
          />
        </Specimen>
        <Specimen
          title="Locked capacity"
          caption="Real resources locked by running apps against the network's benchmarked totals."
          surface="raised"
          layout="stack"
        >
          <div className="kgc-stack">
            <Meter
              label="CPU cores locked"
              value={cap ? cap.apps_locked.cpu : null}
              max={cap?.total.cores ?? 1}
              format={(v, f) =>
                `${formatCompact(v)} of ${formatCompact(cap?.total.cores)} cores, ${Math.round(f * 100)}%`
              }
              loading={capacity.isPending}
              showLabel
              showValue
              endLabel={cap ? `${formatCompact(cap.total.cores)} cores` : undefined}
            />
            <Meter
              label="RAM locked"
              value={cap ? cap.apps_locked.ram_mb / 1024 : null}
              max={cap?.total.ram_gb ?? 1}
              format={(v, f) =>
                `${formatCompact(v)} of ${formatCompact(cap?.total.ram_gb)} GB, ${Math.round(f * 100)}%`
              }
              loading={capacity.isPending}
              showLabel
              showValue
              endLabel={cap ? `${formatCompact(cap.total.ram_gb)} GB` : undefined}
            />
            <Meter
              label="Storage locked"
              value={cap ? cap.apps_locked.hdd_gb : null}
              max={cap?.total.ssd_gb ?? 1}
              format={(v, f) =>
                `${formatCompact(v)} of ${formatCompact(cap?.total.ssd_gb)} GB, ${Math.round(f * 100)}%`
              }
              loading={capacity.isPending}
              showLabel
              showValue
              endLabel={cap ? `${formatCompact(cap.total.ssd_gb)} GB` : undefined}
            />
          </div>
        </Specimen>
        <Specimen
          title="Check-in gauge"
          caption="Synthetic. Zones are named (Healthy, Due, At risk) and the one the reading is in lights up; a notch marks the reading, so state is never color alone."
          surface="raised"
          layout="stack"
        >
          <Meter
            label="Days since last check-in"
            value={age}
            min={0}
            max={100}
            zones={CHECK_IN}
            size="lg"
            showLabel
            showValue
            format={(v) => `${Math.round(v)} of 100`}
            startLabel="0"
            endLabel="100"
          />
          <div className="kgc-controls">
            <Button size="sm" onClick={() => setAge(12)}>
              Healthy
            </Button>
            <Button size="sm" onClick={() => setAge(72)}>
              Due
            </Button>
            <Button size="sm" onClick={() => setAge(94)}>
              At risk
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAge(Math.round(Math.random() * 100))}>
              Random
            </Button>
          </div>
        </Specimen>
        <Specimen
          title="Tones, sizes and a fixed notch"
          caption="Synthetic. 4 px and 8 px tracks, the status tones, and a fixed reference notch (a target) with a title."
          surface="raised"
          layout="stack"
        >
          <div className="kgc-stack">
            <Meter label="Accent, 4 px" value={0.62} showLabel showValue />
            <Meter label="Warning, 8 px" value={0.78} tone="warn" size="lg" showLabel showValue />
            <Meter
              label="Critical with a target"
              value={0.93}
              tone="crit"
              size="lg"
              marker={0.8}
              markerLabel="Target 80%"
              showLabel
              showValue
            />
            <Meter label="Fine detail, near zero" value={0.012} showLabel showValue />
          </div>
        </Specimen>
        <Specimen
          title="Unknown, loading, narrow"
          caption="An unknown reading is a dashed track and the word Unknown, never an empty fill. Loading has the same height."
          surface="raised"
          layout="stack"
          width={260}
        >
          <div className="kgc-stack">
            <Meter label="Unknown reading" value={null} showLabel />
            <Meter label="Loading" value={0.4} loading />
            <Meter
              label="Narrow with ends"
              value={0.37}
              showLabel
              showValue
              startLabel="0"
              midLabel="50%"
              endLabel="100%"
            />
          </div>
        </Specimen>
      </SpecGrid>
    </>
  );
}
