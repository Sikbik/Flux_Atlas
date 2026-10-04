// The parallel assets in one place: what has been mined, what was claimed, what can be claimed now, and how the mined
// total divides between those. The figures are Flux Fusion's, which the server reuses for about ten minutes, so the
// panel says how old they are. Atlas only reads them: claiming happens in Fusion.

import { TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { formatInt, formatPercent } from '../../../../lib/format';
import { AnimatedNumber, RelativeTime, ShareBar, type ShareSegment, Stat, StatGrid } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { claimedShare, composition } from '../../lib/parallel';
import type { ParallelAssetsDto } from '../../types';
import { Panel } from '../../ui/Panel';
import { formatFlux2 } from '../overview/Standing';

/** The panel's aside: whose figures these are and how old, and a warning when the latest refresh failed. */
export function FusionAge({ a, stale }: { a: ParallelAssetsDto; stale: boolean }) {
  return (
    <>
      Flux Fusion, asked <RelativeTime ts={a.fetched_ms} />
      {stale ? (
        <span className="wl-pa-stale">
          <TriangleAlert size={12} strokeWidth={1.5} aria-hidden="true" /> not answering now, showing this
        </span>
      ) : null}
    </>
  );
}

export function Summary({ a, stale }: { a: ParallelAssetsDto; stale: boolean }) {
  const { money } = useWalletCtx();
  const comp = useMemo(() => composition(a.chains), [a.chains]);
  const share = claimedShare(a);
  const nothing = a.mined <= 0;

  const segments: ShareSegment[] = [
    // A progression, not categories: claimed is the deep end of the blue ramp, what waits is the light end.
    { id: 'claimed', label: 'Already claimed', value: comp.claimed, color: 'var(--seq-3)' },
    { id: 'claimable', label: 'Claimable now', value: comp.claimable, color: 'var(--seq-5)' },
    ...(comp.stuck > 0
      ? [{ id: 'stuck', label: 'On an ended chain', value: comp.stuck, color: 'var(--status-off)' }]
      : []),
  ];

  return (
    <Panel title="Parallel assets" aside={<FusionAge a={a} stale={stale} />}>
      <StatGrid min={220}>
        <Stat
          label="Mined, all time"
          value={<AnimatedNumber value={a.mined} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          caption={nothing ? 'nothing accrued yet' : money.text(a.mined)}
        />
        <Stat
          label="Claimed so far"
          value={<AnimatedNumber value={a.claimed} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          caption={share === null ? undefined : `${formatPercent(share, 1)} of what was mined`}
        />
        <Stat
          label="Claimable now"
          value={<AnimatedNumber value={comp.claimable} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          caption={
            comp.claimable > 0
              ? `${money.text(comp.claimable)} on ${formatInt(a.chains.filter((c) => c.active && c.claimable > 0).length)} chains`
              : 'nothing waiting'
          }
        />
      </StatGrid>
      {nothing ? null : (
        <ShareBar
          segments={segments}
          size="lg"
          legend="inline"
          label="Where the mined parallel assets stand"
          format={(v) => `${formatInt(Math.round(v))} FLUX`}
        />
      )}
    </Panel>
  );
}
