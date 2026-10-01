import { Play, RotateCcw, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeStatus } from '../../../api/generated/NodeStatus';
import type { Tier } from '../../../api/generated/Tier';
import { STATUS_CODES, TIER_CODES } from '../../../api/nodesBin';
import { useNetwork, useRuntime } from '../../../app/context';
import { formatBytes, formatHeight, formatInt, parseFlux } from '../../../lib/format';
import { StatusChip } from '../../chips/StatusChip';
import { TierChip } from '../../chips/TierChip';
import { Button } from '../../controls/Button';
import { Amount } from '../../identity/Amount';
import { RelativeTime } from '../../identity/RelativeTime';
import { DataTable } from '../../table/DataTable';
import type { DataTableColumn } from '../../table/types';
import { useFreshKeys } from '../../table/useFreshKeys';
import { GallerySection, SpecGrid, Specimen } from '../primitives';
import './TableSection.css';

// ------------------------------------------------------------------------------------------------
// Nodes: real rows from the live store
// ------------------------------------------------------------------------------------------------

interface NodeRow {
  id: number;
  endpoint: string | null;
  tier: Tier;
  status: NodeStatus;
  rank: number | null;
  country: string | null;
  org: string | null;
  version: string | null;
}

const sameNode = (a: NodeRow, b: NodeRow) =>
  a.endpoint === b.endpoint &&
  a.tier === b.tier &&
  a.status === b.status &&
  a.rank === b.rank &&
  a.country === b.country &&
  a.org === b.org &&
  a.version === b.version;

/**
 * Lightweight rows built from the live store's typed arrays. Rows whose fields did not change keep
 * their object, so when a delta touches one node the table re-renders one row.
 */
function useNodeRows(): { rows: NodeRow[]; loaded: boolean } {
  const store = useRuntime().store;
  const version = useNetwork((s) => s.versions.Nodes);
  const loaded = useNetwork((s) => s.loaded);
  const cache = useRef(new Map<number, NodeRow>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the store's change signal for the node columns
  const rows = useMemo(() => {
    const t = store.nodes;
    const prev = cache.current;
    const next = new Map<number, NodeRow>();
    const out = new Array<NodeRow>(t.count);
    for (let i = 0; i < t.count; i++) {
      const id = t.ids[i]!;
      const rank = t.rank[i]!;
      const row: NodeRow = {
        id,
        endpoint: t.endpoint(i) || null,
        tier: TIER_CODES[t.tier[i]!] ?? 'unknown',
        status: STATUS_CODES[t.status[i]!] ?? 'unknown',
        rank: rank > 0 ? rank - 1 : null,
        country: t.countryCode(i) || null,
        org: t.orgName(i) || null,
        version: t.fluxOs(i) || null,
      };
      const old = prev.get(id);
      const keep = old && sameNode(old, row) ? old : row;
      next.set(id, keep);
      out[i] = keep;
    }
    cache.current = next;
    return out;
  }, [store, version, loaded]);
  return { rows, loaded };
}

const tierCode = (t: Tier) => TIER_CODES.indexOf(t);
const statusCode = (s: NodeStatus) => STATUS_CODES.indexOf(s);

const nodeColumns: DataTableColumn<NodeRow>[] = [
  { id: 'endpoint', header: 'Endpoint', mono: true, sortable: true, width: '1.4fr', minWidth: 180 },
  {
    id: 'tier',
    header: 'Tier',
    sortable: true,
    width: 124,
    // Cumulus first when ascending, Stratus first when descending; unknown tiers last.
    sortValue: (r) => (r.tier === 'unknown' ? null : tierCode(r.tier)),
    cell: (r) => (r.tier === 'unknown' ? null : <TierChip tier={r.tier} size="sm" />),
  },
  {
    id: 'status',
    header: 'Status',
    sortable: true,
    width: 138,
    sortValue: (r) => statusCode(r.status),
    cell: (r) => <StatusChip status={r.status} size="sm" />,
  },
  {
    id: 'rank',
    header: 'Rank',
    numeric: true,
    sortable: true,
    width: 84,
    title: 'Place in the payout queue',
  },
  { id: 'country', header: 'Country', sortable: true, width: 92, mono: true },
  { id: 'org', header: 'Organisation', sortable: true, width: '1.2fr', minWidth: 140 },
  { id: 'version', header: 'FluxOS', sortable: true, width: 110, mono: true },
];

const nodeKey = (r: NodeRow) => r.id;

// A few columns, a wide table: the inspector (420 px) case.
const inspectorColumns: DataTableColumn<NodeRow>[] = [
  { id: 'endpoint', header: 'Endpoint', mono: true, sortable: true, minWidth: 170 },
  {
    id: 'tier',
    header: 'Tier',
    width: 124,
    cell: (r) => (r.tier === 'unknown' ? null : <TierChip tier={r.tier} size="sm" />),
  },
  { id: 'rank', header: 'Rank', numeric: true, sortable: true, width: 76 },
  { id: 'country', header: 'Country', mono: true, width: 84 },
  { id: 'org', header: 'Organisation', minWidth: 150 },
  { id: 'version', header: 'FluxOS', mono: true, width: 110 },
];

// ------------------------------------------------------------------------------------------------
// Blocks: the live ring, with a synthetic arrival button for the new-row motion
// ------------------------------------------------------------------------------------------------

interface BlockRow {
  height: number;
  timeMs: number;
  txCount: number;
  size: number;
  reward: string;
  synthetic: boolean;
}

const blockColumns: DataTableColumn<BlockRow>[] = [
  {
    id: 'height',
    header: 'Height',
    numeric: true,
    sortable: true,
    width: 200,
    cell: (b) => (
      <>
        {formatHeight(b.height)}
        {b.synthetic ? <span className="kg-tbl-tag">synthetic</span> : null}
      </>
    ),
  },
  {
    id: 'age',
    header: 'Age',
    numeric: true,
    sortable: true,
    minWidth: 120,
    sortValue: (b) => b.timeMs,
    cell: (b) => <RelativeTime ts={b.timeMs} />,
  },
  { id: 'txs', header: 'Transactions', numeric: true, sortable: true, value: (b) => b.txCount },
  {
    id: 'size',
    header: 'Size',
    numeric: true,
    sortable: true,
    sortValue: (b) => b.size,
    cell: (b) => formatBytes(b.size),
  },
  {
    id: 'reward',
    header: 'Reward',
    numeric: true,
    sortable: true,
    sortValue: (b) => (parseFlux(b.reward) === null ? null : Number(parseFlux(b.reward))),
    cell: (b) => <Amount value={b.reward} />,
  },
];

/** Synthetic rows get their own key space: the next real block may carry the same height. */
/** A narrow version of the block columns for a 420 px stage. */
const blockLinkColumns: DataTableColumn<BlockRow>[] = [
  {
    id: 'height',
    header: 'Height',
    numeric: true,
    sortable: true,
    width: 120,
    cell: (b) => formatHeight(b.height),
  },
  {
    id: 'age',
    header: 'Age',
    numeric: true,
    width: 110,
    sortValue: (b) => b.timeMs,
    cell: (b) => <RelativeTime ts={b.timeMs} />,
  },
  { id: 'txs', header: 'Txs', numeric: true, title: 'Transactions', value: (b) => b.txCount },
];

const blockKey = (b: BlockRow) => (b.synthetic ? `synthetic-${b.height}` : b.height);
const blockSort = { id: 'height', dir: 'desc' } as const;

// ------------------------------------------------------------------------------------------------
// Synthetic stress table
// ------------------------------------------------------------------------------------------------

interface StressRow {
  id: number;
  handle: string;
  tier: Tier;
  status: NodeStatus;
  rank: number;
  score: number | null;
  bytes: number;
  version: string;
}

/** Row renders since the page loaded; read by the gallery's frame-time check and the button below. */
const stress = { renders: 0 };
(globalThis as { __kitTableRenders?: typeof stress }).__kitTableRenders = stress;

function makeStress(n: number): StressRow[] {
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    return seed / 0x100000000;
  };
  const tiers: Tier[] = ['cumulus', 'nimbus', 'stratus'];
  const statuses: NodeStatus[] = ['confirmed', 'confirmed', 'confirmed', 'started', 'offline', 'expired'];
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    handle: `synthetic-${String(i + 1).padStart(5, '0')}`,
    tier: tiers[Math.floor(rnd() * 3)]!,
    status: statuses[Math.floor(rnd() * statuses.length)]!,
    rank: Math.floor(rnd() * 9000),
    score: rnd() < 0.08 ? null : Math.round(rnd() * 10000) / 100,
    bytes: Math.floor(rnd() * 4e12),
    version: `6.${Math.floor(rnd() * 4)}.${Math.floor(rnd() * 9)}`,
  }));
}

const stressColumns: DataTableColumn<StressRow>[] = [
  {
    id: 'handle',
    header: 'Handle',
    mono: true,
    sortable: true,
    width: '1.2fr',
    minWidth: 160,
    cell: (r) => {
      stress.renders++;
      return r.handle;
    },
  },
  {
    id: 'tier',
    header: 'Tier',
    sortable: true,
    width: 112,
    sortValue: (r) => tierCode(r.tier),
    cell: (r) => <TierChip tier={r.tier} size="sm" />,
  },
  {
    id: 'status',
    header: 'Status',
    sortable: true,
    width: 138,
    sortValue: (r) => statusCode(r.status),
    cell: (r) => <StatusChip status={r.status} size="sm" />,
  },
  { id: 'rank', header: 'Rank', numeric: true, sortable: true, width: 90 },
  {
    id: 'score',
    header: 'Score',
    numeric: true,
    sortable: true,
    width: 90,
    title: 'About 8% of rows have no score (Unknown)',
  },
  {
    id: 'bytes',
    header: 'Stored',
    numeric: true,
    sortable: true,
    width: 110,
    sortValue: (r) => r.bytes,
    cell: (r) => formatBytes(r.bytes),
  },
  { id: 'version', header: 'Version', sortable: true, mono: true, width: 100 },
];

const stressKey = (r: StressRow) => r.id;

// ------------------------------------------------------------------------------------------------
// Section
// ------------------------------------------------------------------------------------------------

/** Gallery section: DataTable. */
export function TableSection() {
  const { rows: nodes, loaded } = useNodeRows();

  // Blocks: the live ring (newest first) plus synthetic arrivals.
  const ring = useNetwork((s) => s.blocks.toArray());
  const blockCache = useRef(new Map<number, BlockRow>());
  const [extra, setExtra] = useState<BlockRow[]>([]);
  const blocks = useMemo(() => {
    const prev = blockCache.current;
    const next = new Map<number, BlockRow>();
    const real = ring.slice(0, 30).map((b) => {
      const row =
        prev.get(b.height) ??
        ({
          height: b.height,
          timeMs: b.timeMs,
          txCount: b.txCount,
          size: b.size,
          reward: b.reward,
          synthetic: false,
        } satisfies BlockRow);
      next.set(b.height, row);
      return row;
    });
    blockCache.current = next;
    return [...extra, ...real];
  }, [ring, extra]);
  const freshBlocks = useFreshKeys(blocks, blockKey);
  const simulateBlock = useCallback(() => {
    setExtra((list) => {
      const top = Math.max(
        blockCache.current.size ? Math.max(...blockCache.current.keys()) : 0,
        ...list.map((b) => b.height),
      );
      return [
        {
          height: top + 1,
          timeMs: Date.now(),
          txCount: 2 + Math.floor(Math.random() * 40),
          size: 600 + Math.floor(Math.random() * 9000),
          reward: '14.00000000',
          synthetic: true,
        },
        ...list,
      ];
    });
  }, []);

  // Stress: 10,000 synthetic rows, one updated on demand.
  const [stressRows, setStressRows] = useState(() => makeStress(10_000));
  const [stressSel, setStressSel] = useState<number | null>(null);
  const [lastRenders, setLastRenders] = useState<number | null>(null);
  const updateSelected = () => {
    if (stressSel === null) return;
    stress.renders = 0;
    setStressRows((rows) => {
      const i = rows.findIndex((r) => r.id === stressSel);
      if (i < 0) return rows;
      const next = rows.slice();
      next[i] = { ...next[i]!, rank: next[i]!.rank + 1, score: (next[i]!.score ?? 0) + 0.01 };
      return next;
    });
    requestAnimationFrame(() => requestAnimationFrame(() => setLastRenders(stress.renders)));
  };

  // Loading hand-over: skeleton rows with the geometry of the loaded rows, then a cross-fade.
  const [phase, setPhase] = useState<'loading' | 'ready'>('loading');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reload = useCallback(() => {
    clearTimeout(timer.current);
    setPhase('loading');
    timer.current = setTimeout(() => setPhase('ready'), 1400);
  }, []);
  useEffect(() => {
    reload();
    return () => clearTimeout(timer.current);
  }, [reload]);
  const handoverRows = useMemo(() => (phase === 'ready' ? nodes.slice(0, 8) : []), [phase, nodes]);

  // Row-link demo rows.
  const linkNodes = useMemo(() => nodes.filter((n) => n.endpoint).slice(0, 12), [nodes]);
  const linkBlocks = useMemo(() => blocks.filter((b) => !b.synthetic).slice(0, 12), [blocks]);

  const [selectedNode, setSelectedNode] = useState<number | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<string | number | null>(null);

  return (
    <GallerySection
      id="table"
      title="Data table"
      lead={
        <>
          One table for every list in Atlas: typed columns, stable sort, windowing above 200 rows, one tab
          stop with a roving active row (Up, Down, Page, Home, End, Enter), sticky header and sticky first
          column, and live-list motion (a new row slides in with a white wash). Unknown values read
          &ldquo;Unknown&rdquo;, never 0 or blank, and sort last in both directions.
        </>
      }
    >
      <SpecGrid min={440}>
        <Specimen
          title="Real nodes."
          caption={
            <>
              Every node from the live store ({loaded ? formatInt(nodes.length) : 'waiting for the snapshot'}{' '}
              rows), sortable and virtualised in a 520 px stage. Click a header to sort (numbers start
              descending; a third click clears), click a row to select it, Tab into the grid and use the arrow
              keys.
            </>
          }
          span={3}
          flush
        >
          <div className="kg-tbl-frame">
            <DataTable
              aria-label="All nodes on the network"
              rows={nodes}
              columns={nodeColumns}
              rowKey={nodeKey}
              height={520}
              loading={!loaded}
              selectedKey={selectedNode}
              onRowClick={(r) => setSelectedNode(r.id)}
              footer={
                <div className="kg-tbl-foot">
                  <span>{formatInt(nodes.length)} nodes</span>
                  <span>{selectedNode === null ? 'No selection' : `Selected node ${selectedNode}`}</span>
                </div>
              }
            />
          </div>
        </Specimen>

        <Specimen
          title="Latest blocks, live."
          caption="The newest 30 blocks from the live ring in a wide explorer window (about 970 px). Ages tick on the shared clock; a real arrival (every 30 s) or the synthetic button slides in at the top with a white wash that decays over 1.6 s, without remounting a single existing row."
          span={2}
          flush
        >
          <div className="kg-tbl-frame">
            <div className="kg-tbl-bar">
              <span className="kg-tbl-bar__label">Blocks</span>
              <Button size="sm" icon={Zap} onClick={simulateBlock}>
                Simulate a block (synthetic)
              </Button>
            </div>
            <DataTable
              aria-label="Latest blocks"
              rows={blocks}
              columns={blockColumns}
              rowKey={blockKey}
              defaultSort={blockSort}
              highlightKeys={freshBlocks}
              selectedKey={selectedBlock}
              onRowClick={(b) => setSelectedBlock(blockKey(b))}
              maxHeight={420}
              loading={ring.length === 0}
            />
          </div>
        </Specimen>

        <Specimen
          title="Inspector width, fill."
          caption="420 px, compact rows (28 px), filling a bounded flex column. The first column stays put when the table scrolls sideways and casts a soft shadow onto what slides under it."
          width={420}
          flush
        >
          <div className="kg-tbl-fill">
            <DataTable
              aria-label="Nodes in a narrow inspector"
              rows={nodes.slice(0, 60)}
              columns={inspectorColumns}
              rowKey={nodeKey}
              rowHeight="compact"
              fill
              loading={!loaded}
            />
          </div>
        </Specimen>

        <Specimen
          title="Synthetic stress, 10,000 rows."
          caption="SYNTHETIC data, not from the network. Windowed: about 40 rows exist in the DOM whatever the scroll position. Select a row and update it to see that one row re-renders."
          span={2}
          flush
        >
          <div className="kg-tbl-frame">
            <div className="kg-tbl-bar">
              <span className="kg-tbl-bar__label">Synthetic, 10,000 rows</span>
              <span className="kg-tbl-bar__read" data-testid="stress-renders">
                {lastRenders === null
                  ? 'No update yet'
                  : `Last update re-rendered ${lastRenders} row${lastRenders === 1 ? '' : 's'}`}
              </span>
              <Button size="sm" icon={Play} disabled={stressSel === null} onClick={updateSelected}>
                Update the selected row
              </Button>
            </div>
            <DataTable
              aria-label="Synthetic stress table, 10,000 rows"
              rows={stressRows}
              columns={stressColumns}
              rowKey={stressKey}
              height={420}
              selectedKey={stressSel}
              onRowClick={(r) => setStressSel(r.id)}
            />
          </div>
        </Specimen>

        <Specimen
          title="Loading, then loaded."
          caption="Skeleton rows have exactly the loaded geometry, so nothing shifts when data arrives; the skeleton cross-fades into rows that rise in with a short stagger. Synthetic delay."
          flush
          span={2}
        >
          <div className="kg-tbl-frame">
            <div className="kg-tbl-bar">
              <span className="kg-tbl-bar__label">{phase === 'loading' ? 'Loading' : 'Loaded'}</span>
              <Button size="sm" icon={RotateCcw} onClick={reload}>
                Replay
              </Button>
            </div>
            <DataTable
              aria-label="Loading hand-over"
              rows={handoverRows}
              columns={nodeColumns}
              rowKey={nodeKey}
              loading={phase === 'loading'}
              skeletonRows={8}
            />
          </div>
        </Specimen>

        <Specimen
          title="Empty."
          caption="A compact state panel inside the table area; the header stays, so the columns are still explained."
          flush
        >
          <div className="kg-tbl-frame" data-stretch="">
            <DataTable
              aria-label="Empty example"
              rows={[]}
              columns={inspectorColumns.slice(0, 3)}
              rowKey={nodeKey}
              fill
            />
          </div>
        </Specimen>

        <Specimen
          title="Row links: nodes."
          caption="rowLink points each row at its node. Enter on the active row or a click opens the node window through the router (Ctrl or Cmd click opens a new tab). Hover shows the pointer; links and buttons inside a cell are never hijacked."
          span={2}
          flush
        >
          <DataTable
            aria-label="Nodes, rows link to the node window"
            rows={linkNodes}
            columns={nodeColumns}
            rowKey={nodeKey}
            rowLink={(r) => (r.endpoint ? { kind: 'node', value: r.endpoint } : null)}
            maxHeight={440}
          />
        </Specimen>

        <Specimen
          title="Row links: blocks."
          caption="Same contract on a different kind: each row opens its block."
          flush
        >
          <DataTable
            aria-label="Blocks, rows link to the block window"
            rows={linkBlocks}
            columns={blockLinkColumns}
            rowKey={blockKey}
            rowLink={(b) => ({ kind: 'block', value: String(b.height) })}
            maxHeight={440}
            loading={ring.length === 0}
          />
        </Specimen>
      </SpecGrid>
    </GallerySection>
  );
}
