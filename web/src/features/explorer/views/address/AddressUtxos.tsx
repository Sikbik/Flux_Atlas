// Unspent outputs, largest first, paged as you scroll.

import { useMemo } from 'react';
import { formatInt } from '../../../../lib/format';
import { liveConfirmations, useTipHeight } from '../../hooks/useChain';
import { useAddressUtxos } from '../../hooks/useExplorerData';
import { Amount, Chip, EmptyState, EntityLink, ErrorState, Skeleton, Windowed } from '../../parts';

const ROW_H = 54;

export function AddressUtxos({ addr }: { addr: string }) {
  const q = useAddressUtxos(addr, { limit: 100 });
  const tip = useTipHeight();
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const total = q.data?.pages[0]?.total ?? null;
  const totalValue = q.data?.pages[0]?.total_value ?? null;
  if (q.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading unspent outputs">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} h={ROW_H - 10} radius={12} style={{ marginBottom: 10 }} />
        ))}
      </div>
    );
  }
  if (q.isError && items.length === 0)
    return <ErrorState title="Could not load the unspent outputs" onRetry={() => void q.refetch()} />;
  if (items.length === 0)
    return <EmptyState title="Nothing unspent">This address holds no unspent outputs.</EmptyState>;
  return (
    <div>
      <p className="ex-utxo-sum">
        <span>
          <strong>{formatInt(total)}</strong> unspent outputs
        </span>
        <span>
          worth <Amount value={totalValue} decimals={2} />
        </span>
      </p>
      <Windowed
        count={items.length}
        rowHeight={ROW_H}
        label="Unspent outputs"
        onNearEnd={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
        renderRow={(i) => {
          const u = items[i]!;
          const conf = liveConfirmations(tip, u.height, u.confirmations);
          return (
            <div className="ex-utxo">
              <div className="ex-utxo__main">
                <span className="ex-mono">
                  <EntityLink kind="tx" value={u.txid} />
                  <span className="ex-muted">:{u.vout}</span>
                </span>
                <span className="ex-utxo__sub">
                  {u.height === null ? (
                    <Chip size="sm">Pending</Chip>
                  ) : (
                    <span>{formatInt(conf)} confirmations</span>
                  )}
                  {u.coinbase ? (
                    <Chip size="sm" title="Coinbase outputs can be spent after 100 confirmations">
                      Coinbase
                    </Chip>
                  ) : null}
                </span>
              </div>
              <Amount value={u.value} decimals={u.value.endsWith('0000') ? 2 : 8} />
            </div>
          );
        }}
      />
      <p className="ex-atx-foot" aria-live="polite">
        {q.isFetchingNextPage
          ? 'Loading more'
          : q.hasNextPage
            ? `${formatInt(items.length)} of ${formatInt(total)} loaded`
            : `All ${formatInt(items.length)} loaded`}
      </p>
    </div>
  );
}
