// Unspent outputs, largest first, paged on request.

import { useMemo } from 'react';
import type { UtxoDto } from '../../../../api/generated/UtxoDto';
import { formatInt } from '../../../../lib/format';
import {
  Amount,
  Button,
  Chip,
  DataTable,
  type DataTableColumn,
  EmptyState,
  EntityLink,
  ErrorState,
} from '../../../../ui';
import { liveConfirmations, useTipHeight } from '../../hooks/useChain';
import { useAddressUtxos } from '../../hooks/useExplorerData';
import { Dense } from '../shared';

function Standing({ u }: { u: UtxoDto }) {
  const tip = useTipHeight();
  const conf = liveConfirmations(tip, u.height, u.confirmations);
  return (
    <span className="ex-utxo">
      {u.height === null ? <Chip size="sm">Pending</Chip> : <span>{formatInt(conf)} confirmations</span>}
      {u.coinbase ? (
        <Chip size="sm" title="Coinbase outputs can be spent after 100 confirmations">
          Coinbase
        </Chip>
      ) : null}
    </span>
  );
}

const COLUMNS: readonly DataTableColumn<UtxoDto>[] = [
  {
    id: 'out',
    header: 'Output',
    minWidth: 220,
    cell: (u) => (
      <span>
        <EntityLink kind="tx" value={u.txid} />
        <span className="ex-muted">:{u.vout}</span>
      </span>
    ),
  },
  {
    id: 'amount',
    header: 'Amount',
    numeric: true,
    minWidth: 170,
    cell: (u) => <Amount value={u.value} decimals={u.value.endsWith('0000') ? 2 : 8} />,
  },
  { id: 'state', header: 'Status', minWidth: 230, cell: (u) => <Standing u={u} /> },
];

export function AddressUtxos({ addr }: { addr: string }) {
  const q = useAddressUtxos(addr, { limit: 100 });
  // Pages are cut by offset: an output listed on two pages (the set changed while paging) shows once.
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (q.data?.pages.flatMap((p) => p.items) ?? []).filter((u) => {
      const k = rowKey(u);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [q.data]);
  const total = q.data?.pages[0]?.total ?? null;
  const totalValue = q.data?.pages[0]?.total_value ?? null;
  if (q.isPending) {
    return <DataTable aria-label="Unspent outputs" rows={[]} columns={COLUMNS} rowKey={rowKey} loading />;
  }
  if (q.isError && items.length === 0) {
    return (
      <ErrorState
        error={q.error}
        title="Could not load the unspent outputs"
        onRetry={() => void q.refetch()}
      />
    );
  }
  if (items.length === 0) {
    return <EmptyState title="Nothing unspent">This address holds no unspent outputs.</EmptyState>;
  }
  return (
    <>
      <p className="ex-note ex-pad">
        <strong className="ui-mono">{formatInt(total)}</strong> unspent outputs, worth{' '}
        <Amount value={totalValue} decimals={2} />.
      </p>
      <Dense>
        <DataTable
          aria-label="Unspent outputs"
          rows={items}
          columns={COLUMNS}
          rowKey={rowKey}
          rowLink={(u) => ({ kind: 'tx', value: u.txid })}
          maxHeight={520}
          footer={
            <div className="ex-foot">
              <span aria-live="polite">
                {q.isFetchingNextPage
                  ? 'Loading more'
                  : q.hasNextPage
                    ? `${formatInt(items.length)} of ${formatInt(total)} loaded`
                    : `All ${formatInt(items.length)} loaded`}
              </span>
              {q.hasNextPage ? (
                <Button size="sm" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
                  Load more
                </Button>
              ) : null}
            </div>
          }
        />
      </Dense>
    </>
  );
}

const rowKey = (u: UtxoDto) => `${u.txid}:${u.vout}`;
