// The transactions of a block, grouped by what they are: value first (transfers, app payments), the
// bulk of node check-ins last and folded. Each row is one link to the transaction; the whole row is
// the hit target. Groups with hundreds of rows are windowed.

import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { NodeTxDto } from '../../../api/generated/NodeTxDto';
import type { TxKind } from '../../../api/generated/TxKind';
import type { TxLite } from '../../../api/generated/TxLite';
import { formatBytes, formatInt, parseFlux } from '../../../lib/format';
import { BLOCK_GROUP_ORDER, NODE_TX_KINDS, TX_KINDS } from '../lib/txkinds';
import { Amount, EntityLink, Section, Windowed } from '../parts';
import { KindTile, NodeLink } from './shared';
import './block.css';

const FOLD_AT = 8;
const FOLD_SHOW = 6;
const WINDOW_AT = 200;
const ROW_H = 46;

const SATS_10K = 10_000n * 100_000_000n;

function TxRow({ tx, node }: { tx: TxLite; node: NodeTxDto | undefined }) {
  const sats = parseFlux(tx.value);
  const nodeKind = node ? NODE_TX_KINDS[node.kind] : null;
  const isNode = tx.kind === 'node_confirm' || tx.kind === 'node_start' || tx.kind === 'node_tx';
  const large = tx.kind === 'transfer' && sats !== null && sats >= SATS_10K;
  return (
    <div className="ex-txrow" data-kind={tx.kind} data-large={large || undefined}>
      <KindTile kind={node?.kind === 'update_confirm' ? 'heartbeat' : tx.kind} />
      <div className="ex-txrow__main">
        <EntityLink kind="tx" value={tx.txid} className="ex-txrow__link" />
        <span className="ex-txrow__sub">
          {isNode ? (
            <>
              {nodeKind ? <span>{nodeKind.label}</span> : null}
              {node ? (
                <NodeLink
                  id={node.node}
                  fallbackEndpoint={node.endpoint}
                  fallbackTier={node.benchmark_tier}
                />
              ) : null}
            </>
          ) : tx.size > 0 ? (
            <span>{formatBytes(tx.size)}</span>
          ) : (
            <span>{TX_KINDS[tx.kind].label}</span>
          )}
        </span>
      </div>
      <div className="ex-txrow__val">{isNode ? null : <Amount value={tx.value} decimals={2} />}</div>
    </div>
  );
}

function Group({
  kind,
  rows,
  nodes,
}: {
  kind: TxKind;
  rows: readonly TxLite[];
  nodes: ReadonlyMap<string, NodeTxDto>;
}) {
  const info = TX_KINDS[kind];
  const foldable = rows.length > FOLD_AT;
  const [open, setOpen] = useState(!foldable);
  const windowed = open && rows.length > WINDOW_AT;
  const shown = open ? rows : rows.slice(0, FOLD_SHOW);
  const total = useMemo(() => {
    if (kind !== 'transfer') return null;
    return rows.reduce((s, r) => s + (parseFlux(r.value) ?? 0n), 0n);
  }, [kind, rows]);
  return (
    <div className="ex-group" data-kind={kind}>
      <div className="ex-group__head">
        <h3 className="ex-group__title" title={info.hint}>
          {info.plural}
        </h3>
        <span className="ex-group__count">{formatInt(rows.length)}</span>
        {total !== null ? (
          <span className="ex-group__total">
            <Amount value={total} decimals={2} /> moved
          </span>
        ) : null}
      </div>
      {windowed ? (
        <div className="ex-group__rows">
          <Windowed
            count={rows.length}
            rowHeight={ROW_H}
            label={info.plural}
            renderRow={(i) => <TxRow tx={rows[i]!} node={nodes.get(rows[i]!.txid)} />}
          />
        </div>
      ) : (
        <ul className="ex-group__rows" aria-label={info.plural}>
          {shown.map((t) => (
            <li key={t.txid}>
              <TxRow tx={t} node={nodes.get(t.txid)} />
            </li>
          ))}
        </ul>
      )}
      {foldable ? (
        <button
          type="button"
          className="ex-group__more"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" data-open={open || undefined} />
          {open ? 'Show fewer' : `Show all ${formatInt(rows.length)}`}
        </button>
      ) : null}
    </div>
  );
}

export function BlockTxs({ txs, nodeTxs }: { txs: readonly TxLite[]; nodeTxs: readonly NodeTxDto[] }) {
  const nodes = useMemo(() => new Map(nodeTxs.map((n) => [n.txid, n])), [nodeTxs]);
  const { coinbase, groups } = useMemo(() => {
    const by = new Map<TxKind, TxLite[]>();
    let cb: TxLite | undefined;
    for (const t of txs) {
      if (t.kind === 'coinbase') {
        cb = t;
        continue;
      }
      const l = by.get(t.kind) ?? [];
      l.push(t);
      by.set(t.kind, l);
    }
    const order = BLOCK_GROUP_ORDER.filter((k) => by.has(k));
    return { coinbase: cb, groups: order.map((k) => [k, by.get(k)!] as const) };
  }, [txs]);
  const count = txs.length;
  return (
    <Section title="Transactions" aside={`${formatInt(count)} in this block`}>
      {coinbase ? (
        <div className="ex-group" data-kind="coinbase">
          <div className="ex-group__rows">
            <TxRow tx={coinbase} node={undefined} />
          </div>
        </div>
      ) : null}
      {groups.map(([k, rows]) => (
        <Group key={k} kind={k} rows={rows} nodes={nodes} />
      ))}
      {count === 0 ? <p className="ex-muted">No transactions are listed for this block.</p> : null}
    </Section>
  );
}
