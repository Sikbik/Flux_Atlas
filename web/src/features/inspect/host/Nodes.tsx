import { useTip } from '../../../app/context';
import { formatInt, parseEndpoint } from '../../../lib/format';
import {
  DataTable,
  type DataTableColumn,
  StatusChip,
  TierGlyph,
  tierLabel,
  Unknown,
  useFreshKeys,
} from '../../../ui';
import { etaShort } from '../derive/eta';
import { blocksSinceConfirm } from '../derive/expiry';
import { estimatePayment } from '../derive/queue';
import { isQuietKind, type NodeStatusKind, nodeStatusKind } from '../derive/statusKind';
import { type NodeLive, useChainClock } from '../sources/live';

/** A node of the host with its place in its tier's queue (null when it is not queued). */
export interface HostRow extends NodeLive {
  position: number | null;
  /** Size of the node's tier queue (0 when not queued). */
  size: number;
}

/** The one word a node wears: its status, sharpened by how long it has gone without a check-in. */
export function useNodeKind(n: NodeLive): NodeStatusKind {
  const tip = useTip()?.height;
  return nodeStatusKind({
    status: n.status,
    reachable: n.reachable,
    sinceConfirm: blocksSinceConfirm(tip, n.lastConfirmed),
  });
}

/** The port and the tier, and, only when the node needs a look, what is wrong with it. A fine node stays quiet. */
function NodeCell({ n }: { n: HostRow }) {
  const kind = useNodeKind(n);
  const port = parseEndpoint(n.endpoint)?.port;
  const tier = n.tier === 'unknown' ? 'Unknown tier' : tierLabel(n.tier);
  const apps = n.appCount > 0 ? ` · ${formatInt(n.appCount)} ${n.appCount === 1 ? 'app' : 'apps'}` : '';
  return (
    <span className="ix-host-node">
      <TierGlyph tier={n.tier} size={16} />
      <span className="ix-host-id" title={n.endpoint || undefined}>
        <span className="ix-host-port">{port ? `:${port}` : n.endpoint || `Node ${n.id}`}</span>
        <span className="ix-host-sub">
          {tier}
          {apps}
        </span>
      </span>
      {isQuietKind(kind) ? (
        <span className="ui-sr-only">Confirmed</span>
      ) : (
        <StatusChip className="ix-host-state" status={kind} size="sm" />
      )}
    </span>
  );
}

/** Where the node stands in its tier's queue and when it is paid: a ticking estimate, labelled as one. */
function QueueCell({ n }: { n: HostRow }) {
  const { tip, anchorMs, nowMs } = useChainClock();
  if (n.position === null) return <span className="ix-dim">Not queued</span>;
  const est =
    tip !== null && anchorMs !== null ? estimatePayment(n.position, n.size, tip, anchorMs, nowMs) : null;
  return (
    <span
      className="ix-host-queue"
      title={`Place ${formatInt(n.position + 1)} of ${formatInt(n.size)}. The time is an estimate at about 30 s per block.`}
    >
      <b>#{formatInt(n.position + 1)}</b>
      {est ? <small>{n.position === 0 ? 'next block' : etaShort(est.etaMs)}</small> : <Unknown />}
    </span>
  );
}

const portOf = (n: HostRow): number | null => parseEndpoint(n.endpoint)?.port ?? null;

const columns: DataTableColumn<HostRow>[] = [
  {
    id: 'node',
    header: 'Node',
    mono: true,
    sortable: true,
    minWidth: 176,
    sortValue: portOf,
    cell: (n) => <NodeCell n={n} />,
  },
  {
    id: 'queue',
    header: 'Paid in',
    numeric: true,
    sortable: true,
    width: 104,
    title: 'Place in the payment queue and an estimated time: about 30 s per block',
    sortValue: (n) => n.position,
    cell: (n) => <QueueCell n={n} />,
  },
];

const rowKey = (n: HostRow) => n.id;
const rowLink = (n: HostRow) => ({ kind: 'node' as const, value: n.endpoint || String(n.id) });

/** Every node on the host, by port. The kit's table: sort by a header, one tab stop, Enter or a click opens the node. */
export function HostNodes({ ip, rows }: { ip: string; rows: readonly HostRow[] }) {
  const fresh = useFreshKeys(rows, rowKey);
  return (
    <DataTable
      aria-label={`Nodes on ${ip}`}
      rows={rows}
      columns={columns}
      rowKey={rowKey}
      rowLink={rowLink}
      highlightKeys={fresh}
      rowHeight={46}
      empty={null}
    />
  );
}
