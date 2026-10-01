// An address's transaction history: newest first, windowed, paged from the server as you scroll. A new
// transaction appears at the top the moment its block lands (the head is refreshed on every tip).

import { ArrowDownLeft, ArrowUpRight, Coins, Repeat2, Server } from 'lucide-react';
import { useMemo } from 'react';
import type { TxDetailDto } from '../../../../api/generated/TxDetailDto';
import { formatInt } from '../../../../lib/format';
import { liveConfirmations, useTipHeight } from '../../hooks/useChain';
import { useAddressTxsLive } from '../../hooks/useExplorerData';
import { describeTxForAddress, type TxForAddress } from '../../lib/addressTxs';
import { TX_KINDS } from '../../lib/txkinds';
import {
  Amount,
  ConfirmationGauge,
  EmptyState,
  EntityLink,
  ErrorState,
  RelativeTime,
  Skeleton,
  StatusChip,
  TIER_LABEL,
  type TierName,
} from '../../parts';
import { AddressTag } from '../shared';

const ROW_H = 66;

function dirIcon(d: TxForAddress['direction'], role: TxForAddress['role']) {
  if (d === 'payout') return <Coins size={16} strokeWidth={1.5} />;
  if (d === 'in') return <ArrowDownLeft size={16} strokeWidth={1.6} />;
  if (d === 'out') return <ArrowUpRight size={16} strokeWidth={1.6} />;
  if (d === 'self') return <Repeat2 size={16} strokeWidth={1.5} />;
  void role;
  return <Server size={15} strokeWidth={1.5} />;
}

function label(d: TxForAddress): string {
  if (d.direction === 'payout') {
    if (d.role === 'stratus' || d.role === 'nimbus' || d.role === 'cumulus')
      return `${TIER_LABEL[d.role]} payout`;
    if (d.role === 'devfund') return 'Dev fund payout';
    return 'Block payout';
  }
  if (d.direction === 'in') return 'Received';
  if (d.direction === 'out') return 'Sent';
  if (d.direction === 'self') return 'Moved within this address';
  return TX_KINDS[d.kind].label;
}

export function TxRow({ tx, addr, tip }: { tx: TxDetailDto; addr: string; tip: number | null }) {
  const d = useMemo(() => describeTxForAddress(tx, addr), [tx, addr]);
  const pending = tx.height === null;
  const conf = liveConfirmations(tip, tx.height, tx.confirmations);
  const tier =
    d.role === 'stratus' || d.role === 'nimbus' || d.role === 'cumulus' ? (d.role as TierName) : undefined;
  return (
    <div className="ex-atx" data-dir={d.direction} data-tier={tier} data-pending={pending || undefined}>
      <span className="ex-atx__tile" aria-hidden="true">
        {dirIcon(d.direction, d.role)}
      </span>
      <div className="ex-atx__main">
        <span className="ex-atx__title">
          <EntityLink kind="tx" value={tx.txid} className="ex-atx__link" />
          <span className="ex-atx__label">{label(d)}</span>
        </span>
        <span className="ex-atx__sub">
          {d.counterparties.length > 0 ? (
            <>
              {d.direction === 'in' ? 'from' : 'to'} <AddressTag address={d.counterparties[0]} />
              {d.moreCounterparties + d.counterparties.length - 1 > 0 ? (
                <span>and {formatInt(d.moreCounterparties + d.counterparties.length - 1)} more</span>
              ) : null}
            </>
          ) : tx.height !== null ? (
            <span>
              in block <EntityLink kind="block" value={tx.height} />
            </span>
          ) : null}
        </span>
      </div>
      <div className="ex-atx__side">
        {d.direction === 'none' ? null : (
          <Amount
            value={d.deltaSats}
            decimals={d.deltaSats % 1_000_000n === 0n ? 2 : 8}
            sign="always"
            tone="signed"
            unit="FLUX"
          />
        )}
        <span className="ex-atx__meta">
          {pending ? (
            <StatusChip status="pending" label="Pending" size="sm" />
          ) : conf < 10 ? (
            <ConfirmationGauge confirmations={conf} size="sm" label={false} />
          ) : null}
          {tx.time_ms !== null ? <RelativeTime ts={tx.time_ms} /> : null}
        </span>
      </div>
    </div>
  );
}

export function AddressTxList({ addr }: { addr: string }) {
  const q = useAddressTxsLive(addr, 50);
  const tip = useTipHeight();
  if (q.isPending) {
    return (
      <div className="ex-atx-skel" aria-busy="true" role="status" aria-label="Loading transactions">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} h={ROW_H - 10} radius={12} style={{ marginBottom: 10 }} />
        ))}
      </div>
    );
  }
  if (q.isError && q.items.length === 0) {
    return <ErrorState title="Could not load the history" onRetry={() => void q.refetch()} />;
  }
  if (q.items.length === 0) {
    return (
      <EmptyState title="No transactions yet">
        This address has never appeared in a transaction on the chain this server follows.
      </EmptyState>
    );
  }
  return (
    <div className="ex-atx-list">
      <WindowedTxs
        items={q.items}
        addr={addr}
        tip={tip}
        onNearEnd={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
      />
      <p className="ex-atx-foot" aria-live="polite">
        {q.isFetchingNextPage
          ? 'Loading older transactions'
          : q.hasNextPage
            ? `${formatInt(q.items.length)} of ${formatInt(q.total)} loaded; scroll for more`
            : `All ${formatInt(q.items.length)} transactions loaded`}
      </p>
    </div>
  );
}

import { Windowed } from '../../parts';

function WindowedTxs({
  items,
  addr,
  tip,
  onNearEnd,
}: {
  items: readonly TxDetailDto[];
  addr: string;
  tip: number | null;
  onNearEnd: () => void;
}) {
  return (
    <Windowed
      count={items.length}
      rowHeight={ROW_H}
      label="Transactions"
      onNearEnd={onNearEnd}
      renderRow={(i) => <TxRow tx={items[i]!} addr={addr} tip={tip} />}
    />
  );
}
