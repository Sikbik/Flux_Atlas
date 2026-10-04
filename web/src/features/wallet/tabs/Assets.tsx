// Parallel assets: what the wallet has accrued on the ten parallel-asset chains, what can be claimed and whether it is
// worth it. The figures come from Flux Fusion through the server, which keeps a copy for about ten minutes; Fusion is
// down on its own schedule, so this tab has its own loading, empty and failed states and never takes the page with it.
// Atlas only reads: it never claims, and never asks for a key.

import { Sprout } from 'lucide-react';
import { EmptyState } from '../../../ui';
import { useWalletCtx } from '../context';
import type { ParallelAssetsDto } from '../types';
import { Panel } from '../ui/Panel';
import { Chains } from './assets/Chains';
import { Accrual, ClaimAll } from './assets/ClaimAll';
import { AssetsSkeleton, Degraded } from './assets/Degraded';
import { History } from './assets/History';
import { FusionAge, Summary } from './assets/Summary';
import './assets.css';

/** An address that has never accrued, claimed or been quoted anything: ten chains of zeros say nothing. */
export function isUntouched(a: ParallelAssetsDto): boolean {
  return a.mined <= 0 && a.claimed <= 0 && a.claimable <= 0 && a.claims.length === 0;
}

export function AssetsTab() {
  const { assets } = useWalletCtx();
  const a = assets.data;

  // The last good answer stays on screen while a refresh fails; the panel says Fusion is not answering.
  if (a) {
    if (isUntouched(a)) {
      return (
        <div className="wl-page wl-assets">
          <Panel title="Parallel assets" aside={<FusionAge a={a} stale={assets.isError} />}>
            <EmptyState compact icon={Sprout} title="Nothing has accrued on this address yet">
              Parallel assets build up as a wallet earns node rewards: each FLUX earned adds a tenth of itself
              on ten other chains, claimable in Flux Fusion. This address has earned none, so there is nothing
              to claim.
            </EmptyState>
          </Panel>
        </div>
      );
    }
    return (
      <div className="wl-page wl-assets">
        <Summary a={a} stale={assets.isError} />
        <div className="wl-duo" data-lean="left">
          <ClaimAll a={a} />
          <Accrual a={a} />
        </div>
        <Chains a={a} />
        <History a={a} />
      </div>
    );
  }
  if (assets.isError) return <Degraded />;
  return <AssetsSkeleton />;
}
