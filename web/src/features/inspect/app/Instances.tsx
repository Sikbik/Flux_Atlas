import { Server } from 'lucide-react';
import { useMemo } from 'react';
import { useRuntime } from '../../../app/context';
import { formatEndpoint } from '../../../lib/format';
import {
  Chip,
  DataTable,
  type DataTableColumn,
  EmptyState,
  RelativeTime,
  StatusChip,
  TierGlyph,
  tierLabel,
  useFreshKeys,
} from '../../../ui';
import { countryName } from '../derive/appSpec';
import type { QueueTier } from '../derive/queue';
import { readNodeLive } from '../sources/live';
import { useAppCtx } from './context';

/** One line of the instance list: a node that runs the app, or one that is installing it right now. */
export interface InstanceRow {
  key: string;
  kind: 'instance' | 'installing';
  endpoint: string;
  tier: QueueTier | 'unknown';
  country: string | null;
  /** When the instance started running (or the install began), unix ms. */
  sinceMs: number | null;
  /** The instance still runs the previous spec during a rolling update. */
  older: boolean;
}

/** Every instance of the app, installs in progress first, then the newest. Updates as nodes come and go. */
export function useInstanceRows(): InstanceRow[] {
  const { detail, live } = useAppCtx();
  const { store } = useRuntime();
  return useMemo(() => {
    const installing = live.installing.map<InstanceRow>((e) => {
      const n = e.node != null ? readNodeLive(store, e.node) : null;
      return {
        key: `i:${e.node ?? e.endpoint}`,
        kind: 'installing',
        endpoint: e.endpoint,
        tier: n?.tier ?? 'unknown',
        country: n?.country ? countryName(n.country) : null,
        sinceMs: e.sinceMs,
        older: false,
      };
    });
    const running = [...detail.instances]
      .sort((a, b) => (b.running_since_ms ?? 0) - (a.running_since_ms ?? 0))
      .map<InstanceRow>((inst) => {
        const n = inst.node != null ? readNodeLive(store, inst.node) : null;
        const cc = inst.country_code || n?.country || '';
        return {
          key: `n:${inst.node ?? inst.endpoint}`,
          kind: 'instance',
          endpoint: inst.endpoint,
          tier: n?.tier ?? 'unknown',
          country: cc ? countryName(cc) : null,
          sinceMs: inst.running_since_ms,
          older: !!(detail.spec_hash && inst.spec_hash && inst.spec_hash !== detail.spec_hash),
        };
      });
    return [...installing, ...running];
  }, [detail, live.installing, store]);
}

function NodeCell({ r }: { r: InstanceRow }) {
  const tier = r.tier === 'unknown' ? null : tierLabel(r.tier);
  const sub = [tier, r.country].filter(Boolean).join(' · ') || 'Location unknown';
  return (
    <span className="ix-inst-node">
      <TierGlyph tier={r.tier} size={16} />
      <span className="ix-inst-id" title={r.endpoint}>
        <span className="ix-inst-ep">{formatEndpoint(r.endpoint, { hideDefaultPort: true })}</span>
        <span className="ix-inst-sub">{sub}</span>
      </span>
      {r.kind === 'installing' ? (
        <StatusChip className="ix-inst-chip" status="syncing" label="Installing" size="sm" />
      ) : r.older ? (
        <Chip
          className="ix-inst-chip"
          size="sm"
          title="This instance still runs the previous spec during a rolling update"
        >
          previous spec
        </Chip>
      ) : null}
    </span>
  );
}

const columns: DataTableColumn<InstanceRow>[] = [
  {
    id: 'node',
    header: 'Node',
    mono: true,
    sortable: true,
    minWidth: 176,
    sortValue: (r) => r.endpoint,
    cell: (r) => <NodeCell r={r} />,
  },
  {
    id: 'since',
    header: 'Up for',
    numeric: true,
    sortable: true,
    width: 92,
    title: 'How long the instance has been running, or installing',
    sortValue: (r) => (r.sinceMs === null ? null : -r.sinceMs),
    cell: (r) => <RelativeTime ts={r.sinceMs} ageOnly />,
  },
];

const ROW_PX = 46;
const HEAD_PX = 36;
/** Past this many rows the list gets a frame of `FRAME_ROWS` and a half row. */
const FRAME_FROM = 16;
const FRAME_ROWS = 9;

const rowKey = (r: InstanceRow) => r.key;
// An install in progress has no page to open yet.
const rowLink = (r: InstanceRow) =>
  r.kind === 'instance' ? { kind: 'node' as const, value: r.endpoint } : null;

/**
 * The nodes that run the app. The kit's table: sorted by a header, windowed past 200 rows, one tab stop, Enter or
 * a click opens the node. Rows that just arrived glow once.
 */
export function InstancesTable() {
  const { detail } = useAppCtx();
  const rows = useInstanceRows();
  const fresh = useFreshKeys(rows, rowKey);
  // A short list scrolls with the page; a long one scrolls inside its own frame, cut through a row so the
  // next one peeks out and says there is more.
  const maxHeight = useMemo(
    () => (rows.length > FRAME_FROM ? HEAD_PX + Math.round((FRAME_ROWS + 0.5) * ROW_PX) : undefined),
    [rows.length],
  );
  if (rows.length === 0) {
    return (
      <EmptyState compact icon={Server} title="No node runs this app right now">
        Instances appear here as nodes install and start the app.
      </EmptyState>
    );
  }
  return (
    <DataTable
      aria-label={`Instances of ${detail.display_name}`}
      rows={rows}
      columns={columns}
      rowKey={rowKey}
      rowLink={rowLink}
      highlightKeys={fresh}
      rowHeight={ROW_PX}
      maxHeight={maxHeight}
      empty={null}
    />
  );
}
