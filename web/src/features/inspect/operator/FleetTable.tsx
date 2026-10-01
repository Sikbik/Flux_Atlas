import { useMemo } from 'react';
import { formatEndpoint, formatInt } from '../../../lib/format';
import { DataTable, type DataTableColumn, StatusChip, TierGlyph, Unknown, useFreshKeys } from '../../../ui';
import { etaShort } from '../derive/eta';
import { type FleetNode, fleetState } from '../derive/operator';
import { estimatePayment } from '../derive/queue';
import { type NodeStatusKind, nodeStatusKind } from '../derive/statusKind';
import { useChainClock } from '../sources/live';

/** The state word a node wears in the list: one shared rule for fleet and host rows. */
const kindOf = (n: FleetNode): NodeStatusKind =>
  n.present
    ? nodeStatusKind({ status: n.status, reachable: n.reachable, sinceConfirm: n.sinceConfirm })
    : 'departed';

/** When a node is paid, ticking: an estimate at about 30 s per block, so the cell says how it was made. */
export function PaidIn({ node }: { node: FleetNode }) {
  const { tip, anchorMs, nowMs } = useChainClock();
  const queued = node.position !== null && (node.status === 'confirmed' || node.status === 'offline');
  if (!queued || node.position === null) return <span className="ix-dim">Not queued</span>;
  if (tip === null || anchorMs === null) return <Unknown />;
  const est = estimatePayment(node.position, 0, tip, anchorMs, nowMs);
  return (
    <span title={`Place ${formatInt(node.position + 1)} in line. An estimate at about 30 s per block.`}>
      {node.position === 0 ? 'next block' : etaShort(est.etaMs)}
    </span>
  );
}

const nodeColumn: DataTableColumn<FleetNode> = {
  id: 'node',
  header: 'Node',
  mono: true,
  sortable: true,
  minWidth: 176,
  sortValue: (n) => n.endpoint || null,
  // The tier, the endpoint, and, only when the node needs a look, what is wrong with it. A healthy node says
  // nothing (its state is read aloud, not drawn), so the exceptions are the only chips in the list.
  cell: (n) => (
    <span className="ix-fleet-node">
      <TierGlyph tier={n.tier === 'unknown' ? 'unknown' : n.tier} size={14} />
      <span className="ix-fleet-ep" title={n.endpoint || undefined}>
        {formatEndpoint(n.endpoint, { hideDefaultPort: true }, `Node ${n.id}`)}
      </span>
      {fleetState(n) === 'ok' ? (
        <span className="ui-sr-only">Confirmed</span>
      ) : (
        <StatusChip className="ix-fleet-state" status={kindOf(n)} size="sm" />
      )}
    </span>
  ),
};

const paidColumn: DataTableColumn<FleetNode> = {
  id: 'paid',
  header: 'Paid in',
  numeric: true,
  sortable: true,
  width: 88,
  title: 'Estimate: about 30 s per block',
  sortValue: (n) => n.position,
  cell: (n) => <PaidIn node={n} />,
};

const COLUMNS = [nodeColumn, paidColumn];

const rowKey = (n: FleetNode) => n.id;
const rowLink = (n: FleetNode) =>
  n.present ? { kind: 'node' as const, value: n.endpoint || String(n.id) } : null;

/**
 * Every node of a fleet, soonest payout first. The kit's table: sorted by header, windowed past 200 rows,
 * one tab stop with a roving row, Enter or a click opens the node. Rows that just arrived glow once.
 */
export function FleetTable({ nodes, label }: { nodes: readonly FleetNode[]; label: string }) {
  const fresh = useFreshKeys(nodes, rowKey);
  // Up to two dozen nodes the page scrolls; a bigger fleet scrolls inside its own frame.
  const maxHeight = useMemo(() => (nodes.length > 24 ? 12 * 34 + 36 : undefined), [nodes.length]);
  return (
    <DataTable
      aria-label={label}
      rows={nodes}
      columns={COLUMNS}
      rowKey={rowKey}
      rowLink={rowLink}
      highlightKeys={fresh}
      defaultSort={{ id: 'paid', dir: 'asc' }}
      maxHeight={maxHeight}
      empty={null}
    />
  );
}
