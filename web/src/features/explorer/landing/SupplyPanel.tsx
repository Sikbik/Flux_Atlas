// The supply at a glance: how much FLUX exists against the announced cap, how much of it is locked as node collateral,
// how much is new each day and when the reward is next cut. The split bar is the supply cut where it sits: locked in
// nodes, the other transparent coins, and the shielded pools. Figures that cannot be told are Unknown, never zero.

import { Coins } from 'lucide-react';
import { useMemo } from 'react';
import { useSupply } from '../../../api/queries';
import { useNetwork } from '../../../app/context';
import { formatCompact, formatDuration, formatInt } from '../../../lib/format';
import { Freshness, ShareBar, Skeleton } from '../../../ui';
import { useRewardCut } from '../../chrome/data';
import { HubFigure, HubFigures, HubLink, HubPanel } from '../../hub';
import { ANNOUNCED_MAX_SUPPLY_FLUX } from '../lib/emission';
import { supplyGlance } from './lib/supply';
import './landing.css';

const SEGMENT_COLOR = {
  locked: 'var(--accent-500)',
  transparent: 'var(--seq-3)',
  shielded: 'var(--viz-3)',
} as const;

function SupplySkeleton() {
  return (
    <div className="ex-supply" aria-hidden="true">
      <div className="ex-supply__skel">
        <Skeleton h={54} radius={8} />
        <Skeleton h={54} radius={8} />
      </div>
      <Skeleton h={96} radius={8} />
    </div>
  );
}

export function SupplyPanel() {
  const q = useSupply();
  const tiers = useNetwork((s) => s.tierStats);
  const cut = useRewardCut();
  const g = useMemo(() => supplyGlance(q.data, tiers), [q.data, tiers]);
  const state = q.isPending ? 'loading' : q.data ? 'ready' : 'error';

  return (
    <HubPanel
      id="ex-supply"
      span="full"
      title="Supply"
      icon={Coins}
      aside={
        q.data?.supply ? (
          <Freshness label="supply" ts={q.data.supply.updated_ms} cadenceMs={600_000} />
        ) : undefined
      }
      state={state}
      skeleton={<SupplySkeleton />}
      error={q.error}
      onRetry={() => void q.refetch()}
      retrying={q.isFetching}
      errorTitle="Could not load the supply"
      errorText="The supply figures come from the chain explorer through this server; try again in a moment."
      footer={
        <>
          <HubLink to={{ type: 'supply', key: null }}>Open the supply</HubLink>
          <span className="ex-foot-note">
            {`The cap of ${formatCompact(ANNOUNCED_MAX_SUPPLY_FLUX)} FLUX is announced, not enforced by the chain's rules`}
          </span>
        </>
      }
    >
      <div className="ex-supply">
        <HubFigures className="ex-supply__figs">
          <HubFigure
            label="Total supply"
            value={g.total === null ? null : formatCompact(g.total)}
            unit="FLUX"
            note={g.capShare === null ? undefined : `${(g.capShare * 100).toFixed(1)}% of the announced cap`}
          />
          <HubFigure
            label="New FLUX a day"
            value={g.perDay === null ? null : formatInt(Math.round(g.perDay))}
            unit="FLUX"
            note="paid out by the block reward"
          />
          <HubFigure
            label="Locked in nodes"
            value={g.locked === null ? null : formatCompact(g.locked)}
            unit="FLUX"
            note={
              g.lockedShare === null
                ? 'needs the node tiers'
                : `${(g.lockedShare * 100).toFixed(1)}% of the supply`
            }
          />
          <HubFigure
            label="Next reward cut"
            value={cut === null ? null : cut.landed ? 'Now' : `in ${formatDuration(cut.etaMs)}`}
            note={cut === null ? undefined : `at block ${formatInt(cut.height)}, an estimate`}
          />
        </HubFigures>

        <div className="ex-supply__split">
          {g.segments.length > 0 && g.total !== null ? (
            <ShareBar
              label="Supply by where it sits"
              size="lg"
              legend="list"
              total={g.total}
              format={(v) => `${formatCompact(v)} FLUX`}
              segments={g.segments.map((s) => ({
                id: s.id,
                label: s.label,
                value: s.value,
                color: SEGMENT_COLOR[s.id],
              }))}
            />
          ) : (
            <p className="ex-mvs__none">The breakdown of the supply is not available yet.</p>
          )}
        </div>
      </div>
    </HubPanel>
  );
}
