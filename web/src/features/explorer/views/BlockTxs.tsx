// The transactions of a block, one section per kind: value first (transfers, app payments), the bulk
// of node check-ins last and folded. A table per kind; a row is one link to the transaction.

import { useMemo } from 'react';
import type { NodeTxDto } from '../../../api/generated/NodeTxDto';
import type { TxKind } from '../../../api/generated/TxKind';
import type { TxLite } from '../../../api/generated/TxLite';
import { formatBytes, formatInt, parseFlux } from '../../../lib/format';
import { Amount, DataTable, type DataTableColumn, EntityLink, Section } from '../../../ui';
import { BLOCK_GROUP_ORDER, NODE_TX_KINDS, TX_KINDS } from '../lib/txkinds';
import { Dense, NodeLink } from './shared';

/** A group longer than this starts folded: the reader opens it on purpose. */
const FOLD_AT = 12;
const MAX_HEIGHT = 420;

const txCell = (t: TxLite) => <EntityLink kind="tx" value={t.txid} />;
const sizeCell = (t: TxLite) => (t.size === null ? null : formatBytes(t.size));

const VALUE_COLUMNS: readonly DataTableColumn<TxLite>[] = [
  { id: 'tx', header: 'Transaction', cell: txCell, minWidth: 180 },
  { id: 'size', header: 'Size', numeric: true, cell: sizeCell, sortable: true, sortValue: (t) => t.size },
  {
    id: 'value',
    header: 'Amount',
    numeric: true,
    cell: (t) => <Amount value={t.value} decimals={2} />,
    sortable: true,
    sortValue: (t) => Number(t.value),
  },
];

function nodeColumns(nodes: ReadonlyMap<string, NodeTxDto>): readonly DataTableColumn<TxLite>[] {
  return [
    { id: 'tx', header: 'Transaction', cell: txCell, minWidth: 180 },
    {
      id: 'what',
      header: 'What it does',
      cell: (t) => {
        const n = nodes.get(t.txid);
        return n ? NODE_TX_KINDS[n.kind].label : null;
      },
      minWidth: 110,
    },
    {
      id: 'node',
      header: 'Node',
      cell: (t) => {
        const n = nodes.get(t.txid);
        return n ? (
          <NodeLink
            id={n.node}
            outpoint={n.collateral}
            fallbackEndpoint={n.endpoint}
            fallbackTier={n.benchmark_tier}
          />
        ) : null;
      },
      minWidth: 200,
    },
  ];
}

const NODE_KINDS: ReadonlySet<TxKind> = new Set(['node_start', 'node_confirm', 'node_tx']);

function TxGroup({
  kind,
  rows,
  nodes,
}: {
  kind: TxKind;
  rows: readonly TxLite[];
  nodes: ReadonlyMap<string, NodeTxDto>;
}) {
  const info = TX_KINDS[kind];
  const columns = useMemo(() => (NODE_KINDS.has(kind) ? nodeColumns(nodes) : VALUE_COLUMNS), [kind, nodes]);
  const moved = useMemo(() => {
    if (kind !== 'transfer') return null;
    return rows.reduce((s, r) => s + (parseFlux(r.value) ?? 0n), 0n);
  }, [kind, rows]);
  const long = rows.length > FOLD_AT;
  return (
    <Section
      title={info.plural}
      collapsible
      defaultOpen={!long}
      flush
      aside={
        <span>
          {formatInt(rows.length)} {rows.length === 1 ? 'transaction' : 'transactions'}
          {moved !== null ? (
            <>
              {', '}
              <Amount value={moved} decimals={2} /> moved
            </>
          ) : null}
        </span>
      }
    >
      <Dense>
        <DataTable
          aria-label={info.plural}
          rows={rows}
          columns={columns}
          rowKey={(t) => t.txid}
          rowLink={(t) => ({ kind: 'tx', value: t.txid })}
          maxHeight={long ? MAX_HEIGHT : undefined}
          rowHeight="compact"
        />
      </Dense>
    </Section>
  );
}

export function BlockTxs({ txs, nodeTxs }: { txs: readonly TxLite[]; nodeTxs: readonly NodeTxDto[] }) {
  const nodes = useMemo(() => new Map(nodeTxs.map((n) => [n.txid, n])), [nodeTxs]);
  const groups = useMemo(() => {
    const by = new Map<TxKind, TxLite[]>();
    for (const t of txs) {
      if (t.kind === 'coinbase') continue;
      const l = by.get(t.kind) ?? [];
      l.push(t);
      by.set(t.kind, l);
    }
    return BLOCK_GROUP_ORDER.filter((k) => by.has(k)).map((k) => [k, by.get(k)!] as const);
  }, [txs]);
  return (
    <>
      {groups.map(([k, rows]) => (
        <TxGroup key={k} kind={k} rows={rows} nodes={nodes} />
      ))}
    </>
  );
}
