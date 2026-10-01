// /mempool: what the network has seen and no block has taken yet. A ring that counts down the 30
// second block interval with a dot per pending transaction, the heartbeat of node check-ins against
// what the network should produce, and a live feed. Everything updates from the socket.

import { Activity, Layers2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useChainBlocks, useRuntime, useSummary, useTip } from '../../../app/context';
import { formatAge, formatInt, parseFlux } from '../../../lib/format';
import { useNow } from '../../../lib/useClock';
import {
  Amount,
  Chip,
  DataTable,
  type DataTableColumn,
  EntityLink,
  ErrorState,
  formatAmountText,
  RelativeTime,
  Row,
  Section,
  Skeleton,
  Sparkline,
  Stat,
  StatGrid,
  StatusChip,
  TimeSeries,
  useFreshKeys,
  ViewHeader,
} from '../../../ui';
import { type MempoolRow, useMempoolLive } from '../hooks/useMempoolLive';
import { TX_KINDS } from '../lib/txkinds';
import { txSizeText } from '../lib/txsize';
import { MempoolRing } from './mempool/MempoolRing';
import { Dense, KIND_ICON } from './shared';
import './mempool/mempool.css';
import './view.css';

type Filter = 'all' | 'value' | 'checkin';

const isCheckin = (kind: string, value: string) =>
  kind === 'node_confirm' ||
  kind === 'node_start' ||
  kind === 'node_tx' ||
  (kind === 'unknown' && Number(value) === 0);

const rowCheck = (r: MempoolRow) => isCheckin(r.tx.kind, r.tx.value);
const rowKey = (r: MempoolRow) => r.tx.txid;

const COLUMNS: readonly DataTableColumn<MempoolRow>[] = [
  {
    id: 'what',
    header: 'What',
    minWidth: 170,
    cell: (r) => {
      const check = rowCheck(r);
      const Icon = KIND_ICON[check ? 'heartbeat' : r.tx.kind === 'unknown' ? 'transfer' : r.tx.kind];
      return (
        <span className="ex-feedwhat" data-check={check || undefined}>
          <Icon size={14} strokeWidth={1.5} aria-hidden="true" />
          {check ? 'Node check-in' : TX_KINDS[r.tx.kind].label}
        </span>
      );
    },
  },
  {
    id: 'amount',
    header: 'Amount',
    numeric: true,
    minWidth: 130,
    cell: (r) => (rowCheck(r) ? '' : <Amount value={r.tx.value} decimals={2} />),
  },
  {
    id: 'tx',
    header: 'Transaction',
    minWidth: 140,
    cell: (r) => <EntityLink kind="tx" value={r.tx.txid} />,
  },
  { id: 'size', header: 'Size', numeric: true, minWidth: 90, cell: (r) => txSizeText(r.tx.size) },
  {
    id: 'seen',
    header: 'Seen',
    numeric: true,
    minWidth: 120,
    cell: (r) =>
      r.firstSeenMs === null ? (
        <span className="ex-muted">before you arrived</span>
      ) : (
        <RelativeTime ts={r.firstSeenMs} ageOnly />
      ),
  },
];

function Feed({ rows }: { rows: readonly MempoolRow[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const shown = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => rowCheck(r) === (filter === 'checkin'))),
    [rows, filter],
  );
  const fresh = useFreshKeys(shown, rowKey);
  const counts = useMemo(() => {
    let c = 0;
    for (const r of rows) if (rowCheck(r)) c++;
    return { all: rows.length, checkin: c, value: rows.length - c };
  }, [rows]);
  return (
    <>
      <Row gap={3} wrap className="ex-filters" role="group" aria-label="Filter pending transactions">
        <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>
          All {formatInt(counts.all)}
        </Chip>
        <Chip selected={filter === 'value'} onClick={() => setFilter(filter === 'value' ? 'all' : 'value')}>
          Value moving {formatInt(counts.value)}
        </Chip>
        <Chip
          selected={filter === 'checkin'}
          onClick={() => setFilter(filter === 'checkin' ? 'all' : 'checkin')}
        >
          Node check-ins {formatInt(counts.checkin)}
        </Chip>
      </Row>
      <Dense>
        <DataTable
          aria-label="Pending transactions"
          rows={shown}
          columns={COLUMNS}
          rowKey={rowKey}
          rowLink={(r) => ({ kind: 'tx', value: r.tx.txid })}
          highlightKeys={fresh}
          maxHeight={480}
          empty={
            <p className="ex-note ex-pad" role="status">
              {rows.length === 0
                ? 'The mempool is empty. The next transaction will appear here the moment the network sees it.'
                : 'Nothing pending matches this filter.'}
            </p>
          }
        />
      </Dense>
    </>
  );
}

function Heartbeat() {
  const blocks = useChainBlocks();
  const summary = useSummary();
  const ordered = useMemo(() => [...blocks].reverse(), [blocks]);
  const expected = summary ? summary.node_count / 500 : null;
  const last = blocks[0];
  const t = ordered.map((b) => b.timeMs);
  const v = ordered.map((b) => b.confirmCount);
  return (
    <>
      <p className="ex-note">
        Every node confirms about every 500 blocks, so each block carries a share of them.
      </p>
      <StatGrid min={170}>
        <Stat
          label="Check-ins in the last block"
          value={last ? formatInt(last.confirmCount) : null}
          unit="nodes"
          caption={expected !== null ? `about ${Math.round(expected)} expected per block` : undefined}
          spark={v.length > 1 ? <Sparkline values={v.slice(-40)} /> : undefined}
        />
        <Stat
          label="Node starts in the last block"
          value={last ? formatInt(last.startCount) : null}
          unit="nodes"
          caption="new nodes asking to join"
        />
      </StatGrid>
      {t.length > 2 ? (
        <div className="ex-after">
          <TimeSeries
            label="How many nodes confirmed in each of the latest blocks, against the number the network should produce"
            t={t}
            series={[
              { key: 'confirms', label: 'Check-ins', values: v },
              ...(expected !== null
                ? [{ key: 'expected', label: 'Expected', values: v.map(() => expected) }]
                : []),
            ]}
            height={170}
            area={false}
            yDomain={[0, null]}
          />
        </div>
      ) : null}
    </>
  );
}

export function MempoolView() {
  const m = useMempoolLive();
  const tip = useTip();
  const nextHeight = tip ? tip.height + 1 : null;
  const { clock } = useRuntime();
  const now = useNow(clock);
  const { waiting, valueTxs, oldest } = useMemo(() => {
    let w = 0n;
    let n = 0;
    let first: number | null = null;
    for (const r of m.rows) {
      if (!rowCheck(r)) {
        w += parseFlux(r.tx.value) ?? 0n;
        n++;
      }
      if (r.firstSeenMs !== null && (first === null || r.firstSeenMs < first)) first = r.firstSeenMs;
    }
    return { waiting: w, valueTxs: n, oldest: first === null ? null : Math.max(0, now - first) };
  }, [m.rows, now]);

  if (m.isPending && m.rows.length === 0) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading the mempool">
        <ViewHeader kind="Mempool" icon={Layers2} title="Mempool" />
        <Section>
          <div className="ex-mempool-grid">
            <Skeleton h={340} radius={170} />
            <Skeleton h={160} radius={12} />
          </div>
        </Section>
      </div>
    );
  }
  if (m.isError && m.rows.length === 0) {
    return (
      <ErrorState error={m.error} title="Could not load the mempool" onRetry={() => void m.refetch()}>
        The pending list comes from this server; try again in a moment.
      </ErrorState>
    );
  }
  return (
    <div className="ex-mempool">
      <ViewHeader
        kind="Mempool"
        icon={Layers2}
        title="Mempool"
        subtitle="Transactions the network has seen that no block has taken yet. Most are nodes checking in; the ones carrying value are highlighted."
        freshness={<StatusChip status="live" label="Live" />}
      />
      <Section>
        <div className="ex-mempool-grid">
          <MempoolRing
            rows={m.rows}
            size={m.size}
            bytes={m.bytes}
            bytesPartial={m.bytesPartial}
            nextHeight={nextHeight}
          />
          <StatGrid min={150} columns={1} className="ex-mempool-side">
            <Stat
              label="Value waiting"
              value={formatAmountText(waiting, { decimals: waiting >= 100_000_000_000n ? 0 : 2 })}
              unit="FLUX"
              caption={
                valueTxs === 0
                  ? 'only node check-ins are pending'
                  : `in ${formatInt(valueTxs)} transaction${valueTxs === 1 ? '' : 's'}`
              }
            />
            <Stat
              label="Longest wait"
              value={oldest === null ? null : formatAge(oldest)}
              caption={oldest === null ? 'not seen by this session yet' : 'since it was first seen'}
            />
          </StatGrid>
        </div>
      </Section>
      <Section title="Check-in heartbeat" icon={Activity} collapsible defaultOpen={false}>
        <Heartbeat />
      </Section>
      <Section title="Pending transactions" aside="newest first" flush>
        <Feed rows={m.rows} />
      </Section>
    </div>
  );
}
