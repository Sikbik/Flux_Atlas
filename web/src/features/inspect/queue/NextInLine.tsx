import { useMemo, useRef } from 'react';
import { useRuntime } from '../../../app/context';
import { formatEndpoint, formatInt } from '../../../lib/format';
import { DataTable, type DataTableColumn, tierLabel, Unknown } from '../../../ui';
import { countryName } from '../derive/appSpec';
import { etaShort } from '../derive/eta';
import { estimatePayment, type QueueTier, type TierQueue } from '../derive/queue';
import { readNodeLive, useChainClock } from '../sources/live';

/** How many of the next payees the list holds; further ones are a scroll away. */
export const NEXT_ROWS = 40;

/** About nine rows and the header: the list is as tall as the ring beside it. */
const NEXT_MAX_HEIGHT = 9 * 34 + 36;

interface NextRow {
  id: number;
  /** Zero-based place in the queue. */
  position: number;
  endpoint: string;
  country: string;
}

/** When a node is paid, ticking: an estimate at about 30 s per block, so the cell says how it was made. */
function PaidIn({ position }: { position: number }) {
  const { tip, anchorMs, nowMs } = useChainClock();
  if (tip === null || anchorMs === null) return <Unknown />;
  const est = estimatePayment(position, 0, tip, anchorMs, nowMs);
  return (
    <span title={`Place ${formatInt(position + 1)} in line. An estimate at about 30 s per block.`}>
      {position === 0 ? 'next block' : etaShort(est.etaMs)}
    </span>
  );
}

const columns: DataTableColumn<NextRow>[] = [
  {
    id: 'place',
    header: '#',
    mono: true,
    width: 52,
    cell: (r) => formatInt(r.position + 1),
  },
  {
    id: 'node',
    header: 'Node',
    mono: true,
    minWidth: 150,
    cell: (r) => (
      <span className="ix-q-node">
        <span className="ix-q-ep" title={r.endpoint || undefined}>
          {formatEndpoint(r.endpoint, {}, `Node ${r.id}`)}
        </span>
        {r.country ? <span className="ix-q-where">{countryName(r.country)}</span> : null}
      </span>
    ),
  },
  {
    id: 'eta',
    header: 'Paid in',
    numeric: true,
    width: 108,
    title: 'Estimate: about 30 s per block',
    cell: (r) => <PaidIn position={r.position} />,
  },
];

const rowKey = (r: NextRow) => r.id;
const rowLink = (r: NextRow) => ({ kind: 'node' as const, value: r.endpoint || String(r.id) });

/** The next payees of one tier as a table: their place, where they are and when they are paid. */
export function NextInLine({
  tier,
  queue,
  selectedId,
}: {
  tier: QueueTier;
  queue: TierQueue;
  selectedId: number | null;
}) {
  const { store } = useRuntime();
  const kept = useRef(new Map<number, NextRow>());

  // Rows keep their identity while nothing about them changed, so the table re-renders only what moved.
  const rows = useMemo(() => {
    const out: NextRow[] = [];
    const seen = new Map<number, NextRow>();
    const n = Math.min(NEXT_ROWS, queue.ids.length);
    for (let position = 0; position < n; position++) {
      const id = queue.ids[position]!;
      const live = readNodeLive(store, id);
      if (!live) continue;
      const old = kept.current.get(id);
      const row: NextRow =
        old && old.position === position && old.endpoint === live.endpoint && old.country === live.country
          ? old
          : { id, position, endpoint: live.endpoint, country: live.country };
      seen.set(id, row);
      out.push(row);
    }
    kept.current = seen;
    return out;
  }, [store, queue.ids]);

  return (
    <section className="ix-q-next" data-tier={tier} aria-label={`Next payees of ${tierLabel(tier)}`}>
      <div className="ix-sub-h">
        <span>Next in line</span>
        <span className="ix-dim">one per block</span>
      </div>
      <DataTable
        aria-label={`Next payees of ${tierLabel(tier)}`}
        rows={rows}
        columns={columns}
        rowKey={rowKey}
        rowLink={rowLink}
        selectedKey={selectedId}
        maxHeight={NEXT_MAX_HEIGHT}
      />
    </section>
  );
}
