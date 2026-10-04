// The next 365 days, and what they are worth at the scenario's price. The projection holds today's nodes and queues
// and marks the reward cut where it lands; the figures beside the chart are the running total after 30, 90 and 365
// days. The chart eases to a new price instead of jumping, and the exact figures change at once.

import { useMemo, useState } from 'react';
import { formatInt } from '../../../../lib/format';
import { AnimatedNumber, SegmentedControl, Stat, StatGrid } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { useTween } from '../../hooks/useTween';
import { buildProjection } from '../../lib/projection';
import { useWalletPrefs } from '../../prefs';
import { Panel } from '../../ui/Panel';
import type { Unit } from '../../viz/DailyChart';
import { ProjectionChart, type ProjectionView } from '../../viz/ProjectionChart';
import { formatFlux2 } from '../overview/Standing';

const HORIZONS = [30, 90, 365] as const;

export interface ProjectionPanelProps {
  unit: Unit;
  onUnit: (u: Unit) => void;
  /** One FLUX in the display currency at the scenario's price; null while unknown. */
  price: number | null;
}

export function ProjectionPanel({ unit, onUnit, price }: ProjectionPanelProps) {
  const { dto, money } = useWalletCtx();
  const includePa = useWalletPrefs((s) => s.includePa);
  const [view, setView] = useState<ProjectionView>('cumulative');
  const e = dto.earnings;
  const proj = useMemo(
    () => buildProjection(e.projection, e.reduction, includePa),
    [e.projection, e.reduction, includePa],
  );
  const eased = useTween(price ?? 0);
  const effective: Unit = unit === 'money' && price === null ? 'flux' : unit;

  if (proj.t.length === 0) {
    return (
      <Panel title="Projection, 365 days">
        <p className="wl-note">There is nothing to project: no node of this wallet is in a payment queue.</p>
      </Panel>
    );
  }

  const at = (days: number) => proj.cumulative[Math.min(days, proj.t.length) - 1] as number;

  return (
    <Panel
      title="Projection, 365 days"
      aside={includePa ? 'native and parallel assets' : 'native only'}
      actions={
        <>
          <SegmentedControl
            size="sm"
            aria-label="Unit"
            value={effective}
            onChange={onUnit}
            options={[
              { value: 'flux', label: 'FLUX' },
              { value: 'money', label: money.currency.toUpperCase(), disabled: price === null },
            ]}
          />
          <SegmentedControl
            size="sm"
            aria-label="Projection view"
            value={view}
            onChange={setView}
            options={[
              { value: 'cumulative', label: 'Running total' },
              { value: 'daily', label: 'Per day' },
            ]}
          />
        </>
      }
    >
      <StatGrid min={200}>
        {HORIZONS.map((d) => (
          <Stat
            key={d}
            label={`Next ${formatInt(d)} days`}
            value={<AnimatedNumber value={at(d)} format={formatFlux2} maxHz={0} />}
            unit="FLUX"
            caption={price === null ? undefined : money.fmt(at(d) * price)}
          />
        ))}
      </StatGrid>

      <ProjectionChart
        proj={proj}
        includePa={includePa}
        view={view}
        unit={effective}
        money={money}
        price={price === null ? null : eased}
        revealKey={`${view}:${effective}:${includePa}`}
      />
    </Panel>
  );
}
