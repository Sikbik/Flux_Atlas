// The apps of the fleet at a glance: how many there are and how many instances that makes, how many nodes carry them,
// which node carries the most and how many apps a node runs on average. The figures roll to their new values when the
// wallet refreshes; they are not tinted, since more apps is not better or worse, only different.

import { useMemo } from 'react';
import { formatInt, shortCollateral } from '../../../../lib/format';
import { AnimatedNumber, ShareBar, type ShareSegment, Stat, StatGrid } from '../../../../ui';
import { useWalletCtx } from '../../context';
import type { AppsSummary } from '../../lib/apps';

const oneDecimal = (v: number): string => v.toFixed(1);

export function Strip({ s }: { s: AppsSummary }) {
  const { fleet } = useWalletCtx();
  const busiest = s.busiest ? fleet.rows.find((r) => r.key === s.busiest?.key) : undefined;

  const mix = useMemo<ShareSegment[]>(
    () => [
      { id: 'hosting', label: 'Running apps', value: s.hosting, color: 'var(--viz-1)' },
      { id: 'idle', label: 'Running none', value: s.idle, color: 'var(--viz-other)' },
    ],
    [s.hosting, s.idle],
  );

  return (
    <StatGrid min={140} className="wl-astrip">
      <Stat
        label="Apps"
        value={<AnimatedNumber value={s.apps} format={formatInt} maxHz={0} tint={false} />}
        caption={`${formatInt(s.instances)} ${s.instances === 1 ? 'instance' : 'instances'} in all`}
      />
      <Stat
        label="Nodes with apps"
        value={<AnimatedNumber value={s.hosting} format={formatInt} maxHz={0} tint={false} />}
        unit={`of ${formatInt(s.nodes)}`}
        caption={
          <span className="wl-amix">
            {s.nodes > 0 ? (
              <ShareBar
                segments={mix}
                legend="none"
                label="Nodes by whether they run an app"
                format={(v) => formatInt(Math.round(v))}
              />
            ) : null}
            <span>
              {s.idle === 0
                ? 'every node runs at least one'
                : `${formatInt(s.idle)} ${s.idle === 1 ? 'runs' : 'run'} none`}
            </span>
          </span>
        }
      />
      <Stat
        label="Busiest node"
        value={
          s.busiest ? (
            <AnimatedNumber value={s.busiest.count} format={formatInt} maxHz={0} tint={false} />
          ) : null
        }
        unit={s.busiest ? (s.busiest.count === 1 ? 'app' : 'apps') : undefined}
        caption={s.busiest ? busiest?.endpoint || shortCollateral(s.busiest.key) : 'no node runs an app'}
      />
      <Stat
        label="Average a node"
        value={
          s.average === null ? null : (
            <AnimatedNumber value={s.average} format={oneDecimal} maxHz={0} tint={false} />
          )
        }
        unit={s.average === null ? undefined : 'apps'}
        caption="over every node, idle ones included"
      />
    </StatGrid>
  );
}
