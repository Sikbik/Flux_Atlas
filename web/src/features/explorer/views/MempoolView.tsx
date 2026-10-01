// /mempool: what the network has seen and no block has taken yet. A ring that counts down the 30
// second block interval with a dot per pending transaction, the heartbeat of node check-ins against
// what the network should produce, and a live feed. Everything updates from the socket.

import { Activity, Layers2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useChainBlocks, useRuntime, useSummary, useTip } from '../../../app/context';
import { formatAge, formatBytes, formatInt, parseFlux } from '../../../lib/format';
import { useNow } from '../../../lib/useClock';
import { Sparkline } from '../../analytics/viz/Sparkline';
import { TimeChart } from '../../analytics/viz/TimeChart';
import { useMempoolLive } from '../hooks/useMempoolLive';
import { TX_KINDS } from '../lib/txkinds';
import {
  Amount,
  CompactAmount,
  EntityHead,
  EntityLink,
  ErrorState,
  LiveBadge,
  Section,
  Skeleton,
  Stat,
  StatGrid,
  ToggleChip,
  Windowed,
} from '../parts';
import { MempoolRing } from './mempool/MempoolRing';
import { KindTile } from './shared';
import './mempool/mempool.css';

type Filter = 'all' | 'value' | 'checkin';

const isCheckin = (kind: string, value: string) =>
  kind === 'node_confirm' ||
  kind === 'node_start' ||
  kind === 'node_tx' ||
  (kind === 'unknown' && Number(value) === 0);

function Feed({ rows }: { rows: ReturnType<typeof useMempoolLive>['rows'] }) {
  const { clock } = useRuntime();
  const now = useNow(clock);
  const [filter, setFilter] = useState<Filter>('all');
  const shown = useMemo(
    () =>
      filter === 'all'
        ? rows
        : rows.filter((r) => isCheckin(r.tx.kind, r.tx.value) === (filter === 'checkin')),
    [rows, filter],
  );
  const counts = useMemo(() => {
    let c = 0;
    for (const r of rows) if (isCheckin(r.tx.kind, r.tx.value)) c++;
    return { all: rows.length, checkin: c, value: rows.length - c };
  }, [rows]);
  return (
    <div>
      <fieldset className="ex-filters">
        <legend className="ex-sr">Filter pending transactions</legend>
        <ToggleChip pressed={filter === 'all'} onClick={() => setFilter('all')}>
          All {formatInt(counts.all)}
        </ToggleChip>
        <ToggleChip
          pressed={filter === 'value'}
          onClick={() => setFilter(filter === 'value' ? 'all' : 'value')}
        >
          Value moving {formatInt(counts.value)}
        </ToggleChip>
        <ToggleChip
          pressed={filter === 'checkin'}
          onClick={() => setFilter(filter === 'checkin' ? 'all' : 'checkin')}
        >
          Node check-ins {formatInt(counts.checkin)}
        </ToggleChip>
      </fieldset>
      {shown.length === 0 ? (
        <p className="ex-muted" role="status">
          {rows.length === 0
            ? 'The mempool is empty. The next transaction will appear here the moment the network sees it.'
            : 'Nothing pending matches this filter.'}
        </p>
      ) : (
        <Windowed
          count={shown.length}
          rowHeight={54}
          label="Pending transactions"
          className="ex-feed"
          rowKey={(i) => shown[i]!.tx.txid}
          renderRow={(i) => {
            const r = shown[i]!;
            const check = isCheckin(r.tx.kind, r.tx.value);
            const age = r.firstSeenMs === null ? null : Math.max(0, now - r.firstSeenMs);
            return (
              <div
                className="ex-feedrow"
                data-check={check || undefined}
                data-fresh={age !== null && age < 4000 ? '' : undefined}
              >
                <KindTile kind={check ? 'heartbeat' : r.tx.kind === 'unknown' ? 'transfer' : r.tx.kind} />
                <div className="ex-feedrow__main">
                  <EntityLink kind="tx" value={r.tx.txid} className="ex-feedrow__link" />
                  <span className="ex-feedrow__sub">
                    {check ? 'Node check-in' : TX_KINDS[r.tx.kind].label}
                    {r.tx.size > 0 ? <span>{formatBytes(r.tx.size)}</span> : null}
                  </span>
                </div>
                <div className="ex-feedrow__side">
                  {check ? null : <Amount value={r.tx.value} decimals={2} />}
                  <span className="ex-time">
                    {age === null ? 'before you arrived' : age < 1000 ? 'now' : `${Math.floor(age / 1000)} s`}
                  </span>
                </div>
              </div>
            );
          }}
        />
      )}
    </div>
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
      <StatGrid min={170}>
        <Stat
          label="Check-ins in the last block"
          value={last ? formatInt(last.confirmCount) : null}
          unit="nodes"
          caption={expected !== null ? `about ${Math.round(expected)} expected per block` : undefined}
          spark={v.length > 1 ? <Sparkline values={v.slice(-40)} width={72} height={26} live /> : undefined}
        />
        <Stat
          label="Node starts in the last block"
          value={last ? formatInt(last.startCount) : null}
          unit="nodes"
          caption="new nodes asking to join"
        />
      </StatGrid>
      {t.length > 2 ? (
        <>
          <div className="ex-gap" />
          <TimeChart
            title="Node check-ins per block"
            summary="How many nodes confirmed in each of the latest blocks, against the number the network should produce"
            t={t}
            series={[{ key: 'confirms', label: 'Check-ins', color: 'var(--viz-1)', values: v, fill: true }]}
            mode="step"
            height={170}
            yMin={0}
            marks={
              expected !== null
                ? [{ kind: 'h', at: expected, label: `expected ${expected.toFixed(1)}`, tone: 'muted' }]
                : []
            }
            live
            unit="nodes"
          />
        </>
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
      if (!isCheckin(r.tx.kind, r.tx.value)) {
        w += parseFlux(r.tx.value) ?? 0n;
        n++;
      }
      if (r.firstSeenMs !== null && (first === null || r.firstSeenMs < first)) first = r.firstSeenMs;
    }
    return { waiting: w, valueTxs: n, oldest: first === null ? null : Math.max(0, now - first) };
  }, [m.rows, now]);
  if (m.isPending && m.rows.length === 0) {
    return (
      <div className="ex-root" role="status" aria-busy="true" aria-label="Loading the mempool">
        <EntityHead
          kind="Mempool"
          icon={Layers2}
          title={<span className="ex-head__word">Mempool</span>}
          loading
        />
        <Section>
          <div className="ex-mempool-grid">
            <Skeleton h={360} radius={20} />
            <Skeleton h={200} radius={14} />
          </div>
        </Section>
      </div>
    );
  }
  if (m.isError && m.rows.length === 0) {
    return (
      <div className="ex-root">
        <ErrorState title="Could not load the mempool" onRetry={() => void m.refetch()} />
      </div>
    );
  }
  return (
    <div className="ex-root">
      <EntityHead
        kind="Mempool"
        icon={Layers2}
        status="pending"
        aside={<LiveBadge />}
        title={<span className="ex-head__word">Mempool</span>}
        sub="Transactions the network has seen that no block has taken yet. Most are nodes checking in; the ones carrying value are highlighted."
      />
      <Section>
        <div className="ex-mempool-grid">
          <MempoolRing rows={m.rows} size={m.size} bytes={m.bytes} nextHeight={nextHeight} />
          <div className="ex-mempool-side">
            <StatGrid min={150} columns={1}>
              <Stat
                label="Value waiting"
                value={<CompactAmount value={waiting} unit={false} />}
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
        </div>
      </Section>
      <Section
        title="Check-in heartbeat"
        icon={Activity}
        collapsible
        defaultOpen={false}
        aside="nodes confirm about every 500 blocks"
      >
        <Heartbeat />
      </Section>
      <Section title="Pending transactions" aside="newest first">
        <Feed rows={m.rows} />
      </Section>
    </div>
  );
}
