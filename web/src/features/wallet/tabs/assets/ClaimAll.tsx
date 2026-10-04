// Two answers to "what should I do with these": what claiming everything at once would leave after Fusion's fee, and
// the pace the parallel assets accrue at (every FLUX a node earns accrues a tenth of itself on each of ten chains, so
// the accrual over all chains equals the native rewards). Atlas never claims; it only reads and advises.

import { formatInt } from '../../../../lib/format';
import { AnimatedNumber } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { flux, MONTH_DAYS, YEAR_DAYS } from '../../lib/money';
import { chainTotals, claimAllSaving, feeShareText } from '../../lib/parallel';
import type { ParallelAssetsDto } from '../../types';
import { Panel } from '../../ui/Panel';
import { formatFlux2 } from '../overview/Standing';

export function ClaimAll({ a }: { a: ParallelAssetsDto }) {
  const { money } = useWalletCtx();
  const m = a.multi;
  const totals = chainTotals(a.chains);
  const saving = claimAllSaving(a.chains, m);
  const feeShare = m.claimable > 0 ? m.fees / m.claimable : null;
  const ended = a.chains.filter((c) => !c.active && c.claimable > 0);
  const net = Math.max(0, m.net);
  // The bar's two parts: what arrives and what goes in fees. A fee smaller than a sliver is still drawn as one.
  const feeWidth = m.claimable > 0 ? Math.max(0.6, (m.fees / m.claimable) * 100) : 0;

  return (
    <Panel
      title="Claim everything at once"
      aside="the quote Flux Fusion gives for every chain it still swaps"
    >
      {m.claimable <= 0 ? (
        <p className="wl-note">
          Nothing can be claimed on the active chains right now. When something accrues, the quote for
          claiming all of it appears here.
        </p>
      ) : (
        <>
          <div
            className="wl-claimall__bar"
            role="img"
            aria-label={`Of ${formatFlux2(m.claimable)} FLUX claimable, ${formatFlux2(net)} FLUX would reach the wallet and ${formatFlux2(m.fees)} FLUX would go in fees`}
          >
            <i data-part="net" style={{ flexBasis: `${100 - feeWidth}%` }} />
            <i data-part="fee" style={{ flexBasis: `${feeWidth}%` }} />
          </div>
          <dl className="wl-claimall__rows">
            <div>
              <dt>Claimable on {formatInt(totals.active)} chains</dt>
              <dd className="ui-mono">
                {formatFlux2(m.claimable)} <small>FLUX</small>
              </dd>
            </div>
            <div>
              <dt>Fusion's fee</dt>
              <dd className="ui-mono">
                {formatFlux2(m.fees)} <small>FLUX, {feeShareText(feeShare)} of it</small>
              </dd>
            </div>
            <div data-total>
              <dt>You would receive</dt>
              <dd className="ui-mono">
                <AnimatedNumber value={net} format={formatFlux2} maxHz={0} /> <small>FLUX</small>
                <span className="wl-claimall__money">{money.text(net)}</span>
              </dd>
            </div>
          </dl>
          {saving > 0 ? (
            <p className="wl-note">
              Claiming each chain on its own would cost <b>{formatFlux2(totals.fees)} FLUX</b> in fees.
              Claiming all at once saves <b>{formatFlux2(saving)} FLUX</b>.
            </p>
          ) : null}
        </>
      )}
      {ended.map((c) => (
        <p className="wl-note" key={c.chain}>
          <b>{c.name}</b> is left out: {formatFlux2(c.claimable)} FLUX still waits there, but Fusion no longer
          swaps it, so it cannot be claimed.
        </p>
      ))}
      <p className="wl-note wl-claimall__never">
        Atlas never claims for you and never asks for a key. Claims are made in Flux Fusion; this page only
        reads what it reports.
      </p>
    </Panel>
  );
}

/** What the parallel assets accrue at the wallet's current pace, a day, a month and a year. */
export function Accrual({ a }: { a: ParallelAssetsDto }) {
  const { dto, money } = useWalletCtx();
  // The server states the pace when the wallet runs confirmed nodes; the wallet's own run-rate is the same figure.
  const perDay = a.accrual_per_day ?? flux(dto.earnings.pa_per_day);
  const none = !(perDay > 0);
  const rows: { id: string; label: string; days: number }[] = [
    { id: 'day', label: 'A day', days: 1 },
    { id: 'month', label: 'A month', days: MONTH_DAYS },
    { id: 'year', label: 'A year', days: YEAR_DAYS },
  ];
  return (
    <Panel title="Accruing now" aside="at the wallet's current pace, over all ten chains">
      {none ? (
        <p className="wl-note">
          No confirmed node is earning for this wallet, so nothing is accruing on the parallel-asset chains.
        </p>
      ) : (
        <dl className="wl-claimall__rows">
          {rows.map((r) => (
            <div key={r.id}>
              <dt>{r.label}</dt>
              <dd className="ui-mono">
                <AnimatedNumber value={perDay * r.days} format={formatFlux2} maxHz={0} /> <small>FLUX</small>
                <span className="wl-claimall__money">{money.text(perDay * r.days)}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="wl-note">
        Every FLUX a node earns accrues another tenth of itself on each of the ten chains, so the total here
        equals the native rewards. It is yours to claim, and it is only worth what it sells for.
      </p>
    </Panel>
  );
}
