// An address's transaction history: newest first, one table, paged from the server on request. A new
// transaction appears at the top the moment its block lands (the head is refreshed on every tip).

import { ArrowDownLeft, ArrowUpRight, Coins, type LucideIcon, Repeat2, Server } from 'lucide-react';
import { useMemo } from 'react';
import type { TxDetailDto } from '../../../../api/generated/TxDetailDto';
import { formatInt } from '../../../../lib/format';
import {
  Amount,
  Button,
  DataTable,
  type DataTableColumn,
  EmptyState,
  EntityLink,
  ErrorState,
  RelativeTime,
  StatusChip,
  type TierName,
  tierLabel,
} from '../../../../ui';
import { ConfirmationGauge } from '../../gauge/ConfirmationGauge';
import { liveConfirmations, useTipHeight } from '../../hooks/useChain';
import { useAddressTxsLive } from '../../hooks/useExplorerData';
import { describeTxForAddress, type TxForAddress } from '../../lib/addressTxs';
import { TX_KINDS } from '../../lib/txkinds';
import { AddressTag, Dense } from '../shared';

interface AddrTx {
  tx: TxDetailDto;
  d: TxForAddress;
}

const ICON: Record<TxForAddress['direction'], LucideIcon> = {
  payout: Coins,
  in: ArrowDownLeft,
  out: ArrowUpRight,
  self: Repeat2,
  none: Server,
};

function label(d: TxForAddress): string {
  if (d.direction === 'payout') {
    if (d.role === 'stratus' || d.role === 'nimbus' || d.role === 'cumulus')
      return `${tierLabel(d.role as TierName)} payout`;
    if (d.role === 'devfund') return 'Dev fund payout';
    return 'Block payout';
  }
  if (d.direction === 'in') return 'Received';
  if (d.direction === 'out') return 'Sent';
  if (d.direction === 'self') return 'Moved within this address';
  return TX_KINDS[d.kind].label;
}

/** The confirmation state of one row; it reads the live tip itself so the rows stay stable between blocks. */
function Standing({ tx }: { tx: TxDetailDto }) {
  const tip = useTipHeight();
  const pending = tx.height === null;
  const conf = liveConfirmations(tip, tx.height, tx.confirmations);
  // Finality fills ten cells while it is young; after that the row says how long ago it happened.
  if (pending) return <StatusChip status="pending" label="Pending" size="sm" />;
  if (conf < 10) return <ConfirmationGauge confirmations={conf} size="sm" label={false} />;
  return tx.time_ms !== null ? <RelativeTime ts={tx.time_ms} /> : null;
}

const COLUMNS: readonly DataTableColumn<AddrTx>[] = [
  {
    id: 'what',
    header: 'What',
    minWidth: 170,
    cell: ({ d }) => {
      const Icon = ICON[d.direction];
      return (
        <span className="ex-what" data-dir={d.direction}>
          <Icon size={14} strokeWidth={1.6} aria-hidden="true" />
          {label(d)}
        </span>
      );
    },
  },
  // The amount sits next to what happened, so on a phone (the table scrolls sideways) it stays in view.
  {
    id: 'amount',
    header: 'Amount',
    numeric: true,
    minWidth: 130,
    cell: ({ d }) =>
      d.direction === 'none' ? (
        ''
      ) : (
        <Amount
          value={d.deltaSats}
          decimals={d.deltaSats % 1_000_000n === 0n ? 2 : 8}
          sign="always"
          tone="signed"
        />
      ),
  },
  {
    id: 'tx',
    header: 'Transaction',
    minWidth: 130,
    cell: ({ tx }) => <EntityLink kind="tx" value={tx.txid} />,
  },
  {
    id: 'with',
    header: 'With',
    minWidth: 170,
    cell: ({ tx, d }) =>
      d.counterparties.length > 0 ? (
        <span>
          {d.direction === 'in' ? 'from ' : 'to '}
          <AddressTag address={d.counterparties[0]} hideLabel />
          {d.moreCounterparties + d.counterparties.length - 1 > 0
            ? ` and ${formatInt(d.moreCounterparties + d.counterparties.length - 1)} more`
            : ''}
        </span>
      ) : tx.height !== null ? (
        <span>
          in block <EntityLink kind="block" value={tx.height} />
        </span>
      ) : null,
  },
  { id: 'when', header: 'Status', minWidth: 150, cell: ({ tx }) => <Standing tx={tx} /> },
];

export function AddressTxList({ addr }: { addr: string }) {
  const q = useAddressTxsLive(addr, 50);
  const rows = useMemo<AddrTx[]>(
    () => q.items.map((tx) => ({ tx, d: describeTxForAddress(tx, addr) })),
    [q.items, addr],
  );
  if (q.isPending) {
    return (
      <DataTable aria-label="Transactions" rows={[]} columns={COLUMNS} rowKey={(r) => r.tx.txid} loading />
    );
  }
  if (q.isError && q.items.length === 0) {
    return <ErrorState error={q.error} title="Could not load the history" onRetry={() => void q.refetch()} />;
  }
  if (q.items.length === 0) {
    return (
      <EmptyState title="No transactions yet">
        This address has never appeared in a transaction on the chain this server follows.
      </EmptyState>
    );
  }
  return (
    <Dense>
      <DataTable
        aria-label="Transactions"
        rows={rows}
        columns={COLUMNS}
        rowKey={(r) => r.tx.txid}
        rowLink={(r) => ({ kind: 'tx', value: r.tx.txid })}
        maxHeight={560}
        footer={
          <div className="ex-foot">
            <span aria-live="polite">
              {q.isFetchingNextPage
                ? 'Loading older transactions'
                : q.hasNextPage
                  ? `${formatInt(q.items.length)} of ${formatInt(q.total)} loaded`
                  : `All ${formatInt(q.items.length)} transactions loaded`}
            </span>
            {q.hasNextPage ? (
              <Button size="sm" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
                Load older
              </Button>
            ) : null}
          </div>
        }
      />
    </Dense>
  );
}
