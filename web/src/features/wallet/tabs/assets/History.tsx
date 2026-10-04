// Every claim Fusion has paid out to this address, newest first: when, on which chain, how much, the fee, where it went
// and the transaction. A claim-all is one Flux main-chain transaction and opens in Atlas; a claim on one chain opens in
// that chain's own explorer, which Atlas can link to but not show. Links to other sites carry the address the server
// built from a fixed template, never text from Fusion.

import { useMemo } from 'react';
import { formatInt } from '../../../../lib/format';
import {
  DataTable,
  type DataTableColumn,
  EntityLink,
  Hash,
  RelativeTime,
  type SortState,
  useFreshKeys,
} from '../../../../ui';
import { useWalletCtx } from '../../context';
import {
  chainName,
  claimChainLabel,
  claimHistoryTotals,
  claimLink,
  explorerUrl,
  isClaimAll,
} from '../../lib/parallel';
import type { PaChain, PaClaim, ParallelAssetsDto } from '../../types';
import { ChainBadge } from '../../ui/ChainBadge';
import { Outbound } from '../../ui/Outbound';
import { Panel } from '../../ui/Panel';
import { formatFlux2 } from '../overview/Standing';

interface ClaimRow extends PaClaim {
  key: string;
  label: string;
  /** The transaction on the chain's explorer, or null. */
  txUrl: string | null;
  /** The receiving address on the chain's explorer, or null. */
  toUrl: string | null;
  chainLabel: string;
}

/** A stable key per claim: its transaction id, with a counter when two share one. */
export function claimKeys(claims: readonly PaClaim[]): string[] {
  const seen = new Map<string, number>();
  return claims.map((c) => {
    const base = c.txid || `${c.chain}:${c.time_ms ?? 'x'}:${c.amount}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}~${n}`;
  });
}

function rowsOf(claims: readonly PaClaim[], chains: readonly PaChain[]): ClaimRow[] {
  const keys = claimKeys(claims);
  return claims.map((c, i) => {
    const chain = chains.find((x) => x.chain === c.chain);
    return {
      ...c,
      key: keys[i] as string,
      label: claimChainLabel(c, chains),
      chainLabel: chainName(c.chain, chains),
      txUrl: claimLink(c, chains),
      toUrl: isClaimAll(c) ? null : explorerUrl(chain?.explorer_address, { address: c.to }),
    };
  });
}

const COLUMNS: readonly DataTableColumn<ClaimRow>[] = [
  {
    id: 'time',
    header: 'Paid',
    sortable: true,
    defaultSortDir: 'desc',
    sortValue: (r) => r.time_ms,
    cell: (r) => (r.time_ms === null ? null : <RelativeTime ts={r.time_ms} />),
    minWidth: 96,
    width: '0.9fr',
  },
  {
    id: 'chain',
    header: 'Chain',
    sortable: true,
    sortValue: (r) => r.label.toLowerCase(),
    cell: (r) => (
      <span className="wl-claimrow__chain">
        <ChainBadge chain={isClaimAll(r) ? 'flux' : r.chain} size="sm" />
        {r.label}
      </span>
    ),
    minWidth: 150,
    width: '1.3fr',
  },
  {
    id: 'amount',
    header: 'Amount',
    numeric: true,
    sortable: true,
    sortValue: (r) => r.amount,
    cell: (r) => (
      <span className="wl-claimrow__amount">
        {formatFlux2(r.amount)} <small>FLUX</small>
      </span>
    ),
    minWidth: 130,
    width: '1fr',
  },
  {
    id: 'fee',
    header: 'Fee',
    numeric: true,
    sortable: true,
    sortValue: (r) => r.fee,
    cell: (r) => (r.fee > 0 ? formatFlux2(r.fee) : null),
    minWidth: 84,
    width: '0.7fr',
  },
  {
    id: 'to',
    header: 'Paid to',
    mono: true,
    cell: (r) =>
      isClaimAll(r) ? (
        <EntityLink kind="address" value={r.to}>
          This wallet
        </EntityLink>
      ) : r.to === '' ? null : (
        <span className="wl-claimrow__link">
          <Hash value={r.to} head={6} tail={5} copy={false} what="receiving address" />
          {r.toUrl ? (
            <Outbound href={r.toUrl} label={`Open ${r.to} on the ${r.chainLabel} explorer`} />
          ) : null}
        </span>
      ),
    minWidth: 150,
    width: '1.3fr',
  },
  {
    id: 'tx',
    header: 'Transaction',
    mono: true,
    cell: (r) => {
      if (r.main_txid) {
        return (
          <span className="wl-claimrow__link">
            <EntityLink kind="tx" value={r.main_txid} label="Open the claim-all transaction" />
            {r.txUrl ? <Outbound href={r.txUrl} label="Open the transaction in the Flux explorer" /> : null}
          </span>
        );
      }
      const body = <Hash value={r.txid} head={6} tail={5} copy={false} what="transaction id" />;
      return r.txUrl ? (
        <span className="wl-claimrow__link">
          {body}
          <Outbound href={r.txUrl} label={`Open the transaction on the ${r.chainLabel} explorer`} />
        </span>
      ) : (
        body
      );
    },
    minWidth: 160,
    width: '1.3fr',
  },
];

const NEWEST: SortState = { id: 'time', dir: 'desc' };

export function History({ a }: { a: ParallelAssetsDto }) {
  const { money } = useWalletCtx();
  const rows = useMemo(() => rowsOf(a.claims, a.chains), [a.claims, a.chains]);
  const fresh = useFreshKeys(rows, (r) => r.key);
  const totals = useMemo(() => claimHistoryTotals(a.claims), [a.claims]);

  return (
    <Panel
      title="Claim history"
      aside={
        totals.count === 0
          ? 'nothing claimed yet'
          : `${formatInt(totals.count)} ${totals.count === 1 ? 'claim' : 'claims'}, ${formatFlux2(totals.amount)} FLUX`
      }
    >
      <DataTable
        aria-label="Parallel-asset claims"
        rows={rows}
        columns={COLUMNS}
        rowKey={(r) => r.key}
        defaultSort={NEWEST}
        highlightKeys={fresh}
        maxHeight={440}
        empty={
          <p className="wl-note wl-claimempty">
            No claim has been made from this address yet. When one is, it appears here with its fee and a link
            to the transaction.
          </p>
        }
        footer={
          totals.count > 0 ? (
            <p className="wl-note wl-claimfoot">
              {formatInt(totals.count)} {totals.count === 1 ? 'claim' : 'claims'} paid{' '}
              {formatFlux2(totals.amount)} FLUX
              {totals.fees > 0 ? `, with ${formatFlux2(totals.fees)} FLUX in fees` : ''}
              {money.price === null ? '' : `, worth ${money.text(totals.amount)} today`}.
            </p>
          ) : undefined
        }
      />
    </Panel>
  );
}
