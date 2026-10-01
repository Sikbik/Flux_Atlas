// /block/$key: a block as a place on the chain. A hero height with previous and next, ten hexagons of
// finality that fill as blocks land, who produced it, where its reward went, and everything in it
// grouped by kind. A height one past the tip is a ghost that fills in the moment the block is mined.

import { Blocks, ChevronLeft, ChevronRight, Clock, Server } from 'lucide-react';
import { useMemo } from 'react';
import { useRuntime } from '../../../app/context';
import { formatBytes, formatInt, formatUtcDateTime, shortCollateral } from '../../../lib/format';
import { useBeat } from '../../../lib/useClock';
import { useTipHeight } from '../hooks/useChain';
import { isNotFound, useBlockData } from '../hooks/useExplorerData';
import { useMempoolLive } from '../hooks/useMempoolLive';
import { payoutSchedule } from '../lib/emission';
import {
  Amount,
  Chip,
  ConfirmationGauge,
  CopyButton,
  EmptyState,
  EntityHead,
  EntityLink,
  ErrorState,
  Hash,
  IconLink,
  KeyValue,
  LiveBadge,
  Numeral,
  RelativeTime,
  Section,
  Skeleton,
  TierChip,
  TierGlyph,
  type TierName,
} from '../parts';
import { BlockTxs } from './BlockTxs';
import { buildSlices, RewardSplit } from './RewardSplit';
import { NodeLink, useNodeInfo } from './shared';
import './block.css';

function BlockSkeleton() {
  return (
    <div className="ex-root" role="status" aria-busy="true" aria-label="Loading block">
      <EntityHead kind="Block" icon={Blocks} title={<Skeleton w={280} h={46} radius={8} />} loading>
        <Skeleton w={190} h={22} radius={11} />
        <Skeleton w={150} h={22} radius={11} />
        <Skeleton w={90} h={22} radius={11} />
      </EntityHead>
      <Section title="Produced by">
        <Skeleton h={66} radius={14} />
      </Section>
      <Section title="Where the reward went">
        <Skeleton h={12} radius={6} style={{ marginBottom: 12 }} />
        <div className="ex-payouts">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} h={106} radius={14} />
          ))}
        </div>
      </Section>
      <Section title="Transactions">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} h={46} radius={10} style={{ marginBottom: 6 }} />
        ))}
      </Section>
    </div>
  );
}

/** A block that does not exist yet: the next one fills in the moment it is mined. */
function BlockGhost({ height, tip }: { height: number; tip: number | null }) {
  const { clock } = useRuntime();
  const beat = useBeat(clock);
  const mempool = useMempoolLive();
  const ahead = tip === null ? 1 : Math.max(1, height - tip);
  const next = ahead === 1;
  const remaining = next ? beat.remainingMs : beat.remainingMs + (ahead - 1) * 30_000;
  const R = 52;
  const C = 2 * Math.PI * R;
  const progress = next ? beat.progress : 0;
  return (
    <div className="ex-root">
      <EntityHead kind="Block" icon={Blocks} title={<Numeral value={height} />} status="pending">
        <Chip icon={Clock}>Not mined yet</Chip>
      </EntityHead>
      <div className="ex-ghost" role="status">
        <div className="ex-ghost__ring">
          <svg width="112" height="112" viewBox="0 0 112 112" aria-hidden="true">
            <circle className="track" cx="56" cy="56" r={R} />
            <circle
              className="arc"
              cx="56"
              cy="56"
              r={R}
              strokeDasharray={C}
              strokeDashoffset={C * (1 - progress)}
            />
          </svg>
          <div className="ex-ghost__count">
            <span>
              {Math.ceil(remaining / 1000)}
              <small>seconds</small>
            </span>
          </div>
        </div>
        <p className="ex-ghost__title">
          {next ? 'Waiting for the next block' : `${formatInt(ahead)} blocks ahead of the chain`}
        </p>
        <p className="ex-ghost__body">
          Blocks arrive about every 30 seconds. This page fills in the moment block {formatInt(height)} is
          mined.
          {mempool.size > 0
            ? ` ${formatInt(mempool.size)} transaction${mempool.size === 1 ? ' is' : 's are'} waiting for it.`
            : ''}
        </p>
      </div>
    </div>
  );
}

function Producer({
  id,
  endpoint,
  tier,
  outpoint,
}: {
  id: number | null;
  endpoint: string | null;
  tier: string | null;
  outpoint: string | null;
}) {
  const info = useNodeInfo(id);
  const t = (info?.tier ?? tier ?? 'unknown') as TierName | 'unknown';
  const known = t === 'cumulus' || t === 'nimbus' || t === 'stratus';
  const ep = info?.endpoint || endpoint;
  return (
    <div className="ex-producer" data-tier={known ? t : undefined}>
      <span className="ex-producer__mark" aria-hidden="true">
        {known ? <TierGlyph tier={t} size={20} /> : <Server size={18} strokeWidth={1.5} />}
      </span>
      <div className="ex-producer__body">
        {ep || id !== null ? (
          <span className="ex-producer__name">
            <NodeLink id={id} fallbackEndpoint={endpoint} fallbackTier={tier} glyph={false} />
          </span>
        ) : (
          <span className="ex-unknown">Unknown producer</span>
        )}
        <span className="ex-producer__sub">
          {info?.cc ? (
            <span>
              Hosted in <EntityLink kind="country" value={info.cc} />
            </span>
          ) : null}
          {outpoint ? (
            <span className="ex-mono" title={outpoint}>
              collateral {shortCollateral(outpoint)}
            </span>
          ) : null}
        </span>
      </div>
      <TierChip tier={known ? t : 'unknown'} />
    </div>
  );
}

export function BlockView({ blockKey }: { blockKey: string }) {
  const q = useBlockData(blockKey);
  const tip = useTipHeight();
  const d = q.data;
  const asHeight = /^\d+$/.test(blockKey) ? Number(blockKey) : null;
  const slices = useMemo(() => {
    if (!d) return [];
    const sched = payoutSchedule(d.block.height);
    return buildSlices(d.block.payouts, d.dev_fund, sched ? sched.devFundMin : null);
  }, [d]);

  if (q.isPending) return <BlockSkeleton />;
  if (!d) {
    if (isNotFound(q.error)) {
      if (asHeight !== null && (tip === null || asHeight > tip))
        return <BlockGhost height={asHeight} tip={tip} />;
      return (
        <div className="ex-root">
          <EmptyState icon={Blocks} title="No such block">
            {asHeight !== null
              ? `Block ${formatInt(asHeight)} is not in the chain this server knows.`
              : 'No block has this hash on the chain this server knows.'}
          </EmptyState>
        </div>
      );
    }
    return (
      <div className="ex-root">
        <ErrorState title="Could not load this block" onRetry={() => void q.refetch()}>
          The explorer did not answer. The block is fine; try again in a moment.
        </ErrorState>
      </div>
    );
  }

  const b = d.block;
  const final = q.confirmations >= 10;
  const kindWord =
    b.kind === 'pon' ? 'Proof of Node' : b.kind === 'pow' ? 'Proof of Work' : 'Unknown consensus';
  const hasPrev = b.height > 0;
  return (
    <div className="ex-root">
      <EntityHead
        kind="Block"
        icon={Blocks}
        title={<Numeral value={b.height} />}
        status={final ? 'ok' : 'pending'}
        aside={final ? null : <LiveBadge label="Following the chain" />}
        actions={
          <>
            <IconLink
              kind="block"
              value={hasPrev ? b.height - 1 : null}
              label="Previous block"
              disabled={!hasPrev}
            >
              <ChevronLeft size={16} strokeWidth={1.6} aria-hidden="true" />
            </IconLink>
            <IconLink
              kind="block"
              value={b.height + 1}
              label={q.hasNext ? 'Next block' : 'Next block (not mined yet)'}
            >
              <ChevronRight size={16} strokeWidth={1.6} aria-hidden="true" />
            </IconLink>
          </>
        }
        sub={<Hash value={b.hash} full copy="always" what="block hash" />}
      >
        <ConfirmationGauge confirmations={q.confirmations} />
        <Chip>{kindWord}</Chip>
        <Chip icon={Clock}>
          {formatUtcDateTime(b.time_ms)} <RelativeTime ts={b.time_ms} />
        </Chip>
        <Chip mono>{formatInt(b.tx_count)} tx</Chip>
        {b.size > 0 ? <Chip mono>{formatBytes(b.size)}</Chip> : null}
      </EntityHead>

      <Section title="Produced by">
        <Producer
          id={d.producer_ref?.id ?? b.producer}
          endpoint={d.producer_ref?.endpoint ?? null}
          tier={d.producer_ref?.tier ?? null}
          outpoint={d.producer_ref?.outpoint ?? d.producer_collateral}
        />
      </Section>

      <Section
        title="Where the reward went"
        aside={
          <span>
            <Amount value={b.reward} decimals={2} /> reward, <Amount value={b.fees} decimals={8} /> fees
          </span>
        }
      >
        {slices.length > 0 ? (
          <RewardSplit slices={slices} />
        ) : (
          <p className="ex-muted">
            {b.kind === 'pow'
              ? 'A Proof of Work block pays its miner and the dev fund; there are no node payouts.'
              : 'This block lists no node payouts.'}
          </p>
        )}
      </Section>

      <BlockTxs txs={d.txs} nodeTxs={d.node_txs} />

      <Section title="Details" collapsible defaultOpen={false}>
        <KeyValue
          items={[
            { label: 'Hash', value: <Hash value={b.hash} full copy="hover" what="block hash" /> },
            { label: 'Previous block', value: <EntityLink kind="block" value={d.prev_hash} /> },
            {
              label: 'Next block',
              value: d.next_hash ? (
                <EntityLink kind="block" value={d.next_hash} />
              ) : q.hasNext ? (
                <EntityLink kind="block" value={b.height + 1} />
              ) : (
                <span className="ex-muted">Not mined yet</span>
              ),
            },
            { label: 'Version', value: formatInt(d.version), mono: true },
            { label: 'Value out', value: <Amount value={d.value_out} decimals={8} /> },
            { label: 'Dev fund output', value: <Amount value={d.dev_fund} decimals={8} /> },
            {
              label: 'Producer collateral',
              value: d.producer_collateral ? (
                <span className="ex-hashrow">
                  {d.producer_collateral}
                  <CopyButton value={d.producer_collateral} what="collateral" />
                </span>
              ) : null,
              mono: true,
            },
          ]}
        />
      </Section>
    </div>
  );
}
