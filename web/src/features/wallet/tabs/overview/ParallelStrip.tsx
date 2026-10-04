// The parallel assets in three figures: what is waiting to be claimed, what claiming everything would leave after the
// fees, and how much of what the wallet has mined it has already claimed. They come from an external service that can
// be down on its own, so this strip has its own loading and failed states and never takes the page with it.

import { CloudOff } from 'lucide-react';
import { formatInt, formatPercent } from '../../../../lib/format';
import { AnimatedNumber, Button, EmptyState, Meter, Stat, StatGrid } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { claimedShare } from '../../lib/parallel';
import { Panel } from '../../ui/Panel';
import { formatFlux2 } from './Standing';

export function ParallelStrip() {
  const { assets, money, setTab } = useWalletCtx();
  const a = assets.data;

  if (!a) {
    return (
      <Panel title="Parallel assets">
        {assets.isError ? (
          <EmptyState compact icon={CloudOff} title="Parallel assets are not available right now" tone="warn">
            Flux Fusion, where they are claimed, is not answering. Everything else on this page is unaffected.
          </EmptyState>
        ) : (
          <StatGrid min={150} columns={3} aria-busy="true">
            <Stat label="Claimable now" loading />
            <Stat label="After claim fees" loading />
            <Stat label="Claimed so far" loading />
          </StatGrid>
        )}
        {assets.isError ? (
          <div>
            <Button size="sm" onClick={() => void assets.refetch()} loading={assets.isFetching}>
              Try again
            </Button>
          </div>
        ) : null}
      </Panel>
    );
  }

  const share = claimedShare(a);
  const chains = a.chains.filter((c) => c.active).length;
  return (
    <Panel title="Parallel assets" aside="claimed in Flux Fusion">
      <StatGrid min={150} columns={2}>
        <Stat
          label="Claimable now"
          value={<AnimatedNumber value={a.multi.claimable} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          caption={`${money.text(a.multi.claimable)} across ${formatInt(chains)} chains`}
        />
        <Stat
          label="After claim fees"
          value={<AnimatedNumber value={a.multi.net} format={formatFlux2} maxHz={0} />}
          unit="FLUX"
          caption={`${formatFlux2(a.multi.fees)} FLUX in fees, ${money.text(a.multi.net)} net`}
        />
      </StatGrid>
      <Meter
        label="Claimed so far"
        value={share}
        size="lg"
        showLabel
        showValue
        format={(_, fraction) => formatPercent(fraction, 1)}
        startLabel={`${formatInt(Math.round(a.claimed))} FLUX claimed`}
        endLabel={`${formatInt(Math.round(a.mined))} mined`}
      />
      <button type="button" className="wl-more" onClick={() => setTab('assets')}>
        Open the chains and the claim history
      </button>
    </Panel>
  );
}
