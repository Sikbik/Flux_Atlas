// One rich-list row. Rank, address (with its known label), balance, share of the supply, and for an
// address that runs nodes how much of its balance is locked as collateral. The locked figure needs the
// address's node counts, so a row fetches them only after it has stayed on screen for a moment.

import { useQuery } from '@tanstack/react-query';
import type { CSSProperties } from 'react';
import type { RichListEntry } from '../../../../api/generated/RichListEntry';
import { queries } from '../../../../api/queries';
import { formatInt, parseFlux } from '../../../../lib/format';
import { useCollateral } from '../../hooks/useCollateral';
import { useDwell } from '../../hooks/useDom';
import { lockedSats } from '../../lib/richlist';
import { Amount, cx } from '../../parts';
import { AddressTag } from '../shared';
import { formatShare } from './Concentration';
import './richlist.css';

export const ROW_HEIGHT = 58;

function Locked({ e, balance }: { e: RichListEntry; balance: bigint }) {
  const dwelled = useDwell(220);
  const q = useQuery({ ...queries.address(e.address), enabled: dwelled });
  const collateral = useCollateral();
  if (!q.data) {
    return (
      <span className="ex-rrow__lock" data-state={q.isError ? 'off' : 'wait'}>
        <span className="ex-rrow__lockbar" aria-hidden="true" />
        <span className="ex-rrow__locktext ex-muted">{q.isError ? 'unavailable' : null}</span>
      </span>
    );
  }
  const locked = lockedSats(q.data.node_counts, collateral, balance);
  const frac = balance > 0n ? Number((locked * 10000n) / balance) / 10000 : 0;
  const pct = Math.round(frac * 100);
  return (
    <span
      className="ex-rrow__lock"
      title={`${formatInt(Number(locked / 100_000_000n))} of ${formatInt(Number(balance / 100_000_000n))} FLUX is collateral held by nodes`}
    >
      <span className="ex-rrow__lockbar" aria-hidden="true">
        <i style={{ '--w': frac } as CSSProperties} />
      </span>
      <span className="ex-rrow__locktext">{pct}% locked</span>
    </span>
  );
}

export function RichRow({ e, maxShare }: { e: RichListEntry; maxShare: number }) {
  const balance = parseFlux(e.balance) ?? 0n;
  const w = maxShare > 0 ? Math.min(1, e.share_pct / maxShare) : 0;
  return (
    <div className="ex-rrow" data-top={e.rank <= 3 || undefined}>
      <span className="ex-rrow__rank">
        <span className="ex-sr">Rank </span>
        {formatInt(e.rank)}
      </span>
      <div className="ex-rrow__main">
        <AddressTag address={e.address} />
      </div>
      <span className="ex-rrow__bal">
        <Amount value={e.balance} decimals={0} unit={false} />
        <span className="ex-sr"> FLUX</span>
      </span>
      <span className="ex-rrow__share">
        <span className="ex-rrow__pct">
          {formatShare(e.share_pct)}
          <span className="ex-sr"> of the supply</span>
        </span>
        <span className="ex-rrow__bar" aria-hidden="true">
          <i style={{ '--w': w } as CSSProperties} />
        </span>
      </span>
      <span className={cx('ex-rrow__nodes', e.node_count === 0 && 'is-none')}>
        {e.node_count === 0 ? (
          <span className="ex-muted">No nodes</span>
        ) : (
          <>
            <span className="ex-rrow__count">
              {formatInt(e.node_count)} {e.node_count === 1 ? 'node' : 'nodes'}
            </span>
            <Locked e={e} balance={balance} />
          </>
        )}
      </span>
    </div>
  );
}
