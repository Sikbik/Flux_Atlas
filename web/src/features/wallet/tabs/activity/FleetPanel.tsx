// The fleet over time: a stacked chart of the confirmed nodes by tier at the end of each UTC day the server has kept. A
// fleet that Atlas has only just started to track has one day, which is not a chart; it says so, in words, and the
// chart appears by itself once a second day is kept.

import { History, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { formatInt } from '../../../../lib/format';
import { EmptyState } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { fleetChange, fleetSeries, tiersPresent, trimLeadingEmpty } from '../../lib/activity';
import { Panel } from '../../ui/Panel';
import { FleetChart } from '../../viz/FleetChart';

export function FleetPanel() {
  const { dto } = useWalletCtx();
  const series = useMemo(() => trimLeadingEmpty(fleetSeries(dto.fleet_history)), [dto.fleet_history]);
  const tiers = useMemo(() => tiersPresent(series), [series]);
  const change = useMemo(() => fleetChange(series), [series]);
  const n = series.t.length;
  const now = series.total.at(-1) ?? 0;

  const aside =
    change && n >= 2
      ? `${formatInt(n)} days, ${change.net === 0 ? 'no change' : `${change.net > 0 ? '+' : '-'}${formatInt(Math.abs(change.net))} ${Math.abs(change.net) === 1 ? 'node' : 'nodes'}`}`
      : n === 1
        ? 'one day so far'
        : undefined;

  return (
    <Panel title="The fleet over time" icon={TrendingUp} aside={aside}>
      {n >= 2 ? (
        <FleetChart series={series} tiers={tiers} />
      ) : (
        <EmptyState
          compact
          icon={History}
          title={n === 1 ? 'Only today is recorded so far' : 'No history yet'}
        >
          {n === 1
            ? `Atlas has kept one day of this fleet so far: ${formatInt(now)} ${now === 1 ? 'node' : 'nodes'}. The chart draws itself once a second day is kept.`
            : 'Atlas has not kept a day of this fleet yet. The chart draws itself once it has two.'}
        </EmptyState>
      )}
    </Panel>
  );
}
