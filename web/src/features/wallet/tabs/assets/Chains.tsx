// One card per parallel-asset chain: what is claimable, what claiming it would cost against what it is worth, and
// whether to claim now or wait. The fee gauge is the reading; the verdict is the advice, in words as well as colour.
// A chain Fusion no longer swaps (Ergo in 2026) still accrues but cannot be claimed: its card says so and carries no
// advice. Atlas draws no third-party logos: the badge is the ticker in a hexagon.

import { useMemo } from 'react';
import { formatInt, formatPercent } from '../../../../lib/format';
import { AnimatedNumber, Hash, StatusChip, type StatusKind } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { flux } from '../../lib/money';
import {
  type ClaimVerdict,
  claimEfficiency,
  daysToWorth,
  feeShareText,
  receivingLink,
  sortChains,
  verdictView,
  waitText,
} from '../../lib/parallel';
import type { PaChain, PaClaim, ParallelAssetsDto } from '../../types';
import { ChainBadge } from '../../ui/ChainBadge';
import { Outbound } from '../../ui/Outbound';
import { Panel } from '../../ui/Panel';
import { FeeGauge } from '../../viz/FeeGauge';
import { formatFlux2 } from '../overview/Standing';

/** The share of the native rewards each chain accrues a day (the parallel-asset rule: a tenth on each chain). */
const PER_CHAIN_SHARE = 0.1;

const STATUS_OF: Record<ClaimVerdict, StatusKind> = {
  worth: 'confirmed',
  fair: 'pending',
  wait: 'at-risk',
  underwater: 'error',
  nothing: 'unknown',
  unknown: 'unknown',
  inactive: 'departed',
};

export function Chains({ a }: { a: ParallelAssetsDto }) {
  const { dto } = useWalletCtx();
  const chains = useMemo(() => sortChains(a.chains), [a.chains]);
  const perDay = flux(dto.earnings.native_per_day) * PER_CHAIN_SHARE;
  const active = chains.filter((c) => c.active).length;
  return (
    <Panel
      title="Chains"
      aside={`${formatInt(chains.length)} ${chains.length === 1 ? 'chain' : 'chains'}, ${formatInt(active)} can be claimed`}
    >
      {chains.length === 0 ? (
        <p className="wl-note">Flux Fusion lists no chain for this address.</p>
      ) : (
        <ul className="wl-chains" aria-label="Parallel-asset chains">
          {chains.map((c) => (
            <ChainCard key={c.chain} chain={c} claims={a.claims} perDay={perDay} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ChainCard({
  chain,
  claims,
  perDay,
}: {
  chain: PaChain;
  claims: readonly PaClaim[];
  perDay: number;
}) {
  const { money } = useWalletCtx();
  const eff = claimEfficiency(chain);
  const view = verdictView(eff.verdict);
  const recv = receivingLink(chain, claims);
  const claimedShare = chain.mined > 0 ? Math.min(1, Math.max(0, chain.claimed / chain.mined)) : null;
  const wait = eff.verdict === 'wait' || eff.verdict === 'underwater' ? daysToWorth(eff, perDay) : null;

  let advice: string | null = null;
  switch (eff.verdict) {
    case 'inactive':
      advice = 'Fusion no longer swaps this chain. It still accrues, but it cannot be claimed.';
      break;
    case 'fair':
      advice = 'A small share goes in the fee. Fine to claim, or wait to make it smaller.';
      break;
    case 'wait':
    case 'underwater':
      advice =
        wait === null
          ? `A claim here is worth making from about ${formatInt(Math.round(eff.worthAt))} FLUX.`
          : `Worth claiming from about ${formatInt(Math.round(eff.worthAt))} FLUX, ${waitText(wait)} away at this pace.`;
      break;
    case 'unknown':
      advice = 'Fusion has not published this chain’s claim fee, so there is nothing to compare.';
      break;
    default:
      advice = null;
  }

  return (
    <li className="wl-chaincard" data-tone={view.tone} data-inactive={!chain.active || undefined}>
      <div className="wl-chaincard__head">
        <ChainBadge chain={chain.chain} inactive={!chain.active} />
        <div className="wl-chaincard__id">
          <strong>{chain.name}</strong>
          <span className="wl-chaincard__fee">
            {eff.feeKnown ? `claim fee ${formatFlux2(eff.fee)} FLUX` : 'claim fee not published'}
          </span>
        </div>
        <StatusChip status={STATUS_OF[eff.verdict]} label={view.label} size="sm" />
      </div>

      <div className="wl-chaincard__figure">
        <span className="wl-chaincard__big ui-mono">
          <AnimatedNumber value={chain.claimable} format={formatFlux2} maxHz={0} />
          <small>FLUX</small>
        </span>
        <span className="wl-chaincard__sub">
          {chain.claimable > 0 ? `${money.text(chain.claimable)} claimable` : 'nothing claimable'}
        </span>
      </div>

      {chain.active && chain.claimable > 0 && eff.feeKnown ? (
        <>
          <FeeGauge share={eff.feeShare} verdict={eff.verdict} />
          <p className="wl-chaincard__read">
            The fee is <b>{feeShareText(eff.feeShare)}</b> of this claim, so{' '}
            <b>{formatFlux2(eff.net)} FLUX</b> would arrive.
          </p>
        </>
      ) : null}
      {advice ? <p className="wl-note wl-chaincard__advice">{advice}</p> : null}

      <dl className="wl-chaincard__facts">
        <div>
          <dt>Mined</dt>
          <dd className="ui-mono">{formatFlux2(chain.mined)}</dd>
        </div>
        <div>
          <dt>Claimed</dt>
          <dd className="ui-mono">
            {formatFlux2(chain.claimed)}
            {claimedShare === null ? null : <small>{formatPercent(claimedShare, 0)}</small>}
          </dd>
        </div>
        <div>
          <dt>Fees paid</dt>
          <dd className="ui-mono">{formatFlux2(chain.fees_paid)}</dd>
        </div>
      </dl>
      {claimedShare === null ? null : (
        <span
          className="wl-chaincard__bar"
          role="img"
          aria-label={`${formatPercent(claimedShare, 0)} of what was mined on ${chain.name} has been claimed`}
        >
          <i style={{ width: `${Math.max(claimedShare > 0 ? 2 : 0, claimedShare * 100).toFixed(2)}%` }} />
        </span>
      )}

      {recv ? (
        <p className="wl-chaincard__to">
          <span>Last paid to</span>
          <Hash value={recv.address} head={6} tail={5} what={`${chain.name} receiving address`} />
          <Outbound href={recv.url} label={`Open ${recv.address} on the ${chain.name} explorer`} />
        </p>
      ) : null}
    </li>
  );
}
