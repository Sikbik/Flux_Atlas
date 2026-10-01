// /block/$key: a block as a place on the chain. Its height, ten hexagons of finality that fill as
// blocks land, who produced it, where its reward went, and everything in it grouped by kind. A height
// one past the tip is a ghost that fills in the moment the block is mined.

import { Blocks, ChevronLeft, ChevronRight, Clock, type LucideIcon, Server } from 'lucide-react';
import { type MouseEvent, useMemo } from 'react';
import { useRuntime } from '../../../app/context';
import {
  formatBytes,
  formatHeight,
  formatInt,
  formatUtcDateTime,
  shortCollateral,
} from '../../../lib/format';
import { useBeat } from '../../../lib/useClock';
import {
  Amount,
  Card,
  Chip,
  EmptyState,
  EntityLink,
  ErrorState,
  Hash,
  IconButton,
  KeyValue,
  RelativeTime,
  Row,
  Section,
  Skeleton,
  Stack,
  StatusChip,
  TierChip,
  TierGlyph,
  type TierName,
  Unknown,
  useEntityLinkProps,
  ViewHeader,
} from '../../../ui';
import { ConfirmationGauge } from '../gauge/ConfirmationGauge';
import { useTipHeight } from '../hooks/useChain';
import { isNotFound, useBlockData } from '../hooks/useExplorerData';
import { useMempoolLive } from '../hooks/useMempoolLive';
import { payoutSchedule } from '../lib/emission';
import { BlockTxs } from './BlockTxs';
import { buildSlices, RewardSplit } from './RewardSplit';
import { NodeLink, useNodeInfo } from './shared';
import './block.css';

function BlockSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading block">
      <ViewHeader kind="Block" icon={Blocks} title={<Skeleton w={190} h={26} radius={6} />}>
        <Skeleton w={190} h={22} radius={11} />
        <Skeleton w={150} h={22} radius={11} />
      </ViewHeader>
      <Section title="Produced by">
        <Skeleton h={64} radius={12} />
      </Section>
      <Section title="Where the reward went">
        <Stack gap={5}>
          <Skeleton h={16} radius={8} />
          <Skeleton h={112} radius={8} />
        </Stack>
      </Section>
      <Section title="Transactions">
        <Skeleton h={150} radius={8} />
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
    <div>
      <ViewHeader kind="Block" icon={Blocks} title={formatHeight(height)} mono>
        <Chip icon={Clock}>Not mined yet</Chip>
      </ViewHeader>
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
    <Card padding="md">
      <Row gap={5} justify="between">
        <Row gap={5} wrap={false}>
          <span className="ex-producer__mark" aria-hidden="true">
            {known ? <TierGlyph tier={t} size={22} /> : <Server size={20} strokeWidth={1.5} />}
          </span>
          <Stack gap={2}>
            {ep || id !== null ? (
              <NodeLink id={id} fallbackEndpoint={endpoint} glyph={false} />
            ) : (
              <Unknown>Unknown producer</Unknown>
            )}
            <Row gap={5} className="ex-producer__sub">
              {info?.cc ? (
                <span>
                  Hosted in <EntityLink kind="country" value={info.cc} />
                </span>
              ) : null}
              {outpoint ? (
                <span className="ui-mono" title={outpoint}>
                  collateral {shortCollateral(outpoint)}
                </span>
              ) : null}
            </Row>
          </Stack>
        </Row>
        <TierChip tier={known ? t : 'unknown'} />
      </Row>
    </Card>
  );
}

/** Previous and next block: an icon button that navigates like the entity link it stands for. */
function StepButton({
  height,
  label,
  icon,
  disabled,
}: {
  height: number;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
}) {
  const link = useEntityLinkProps('block', String(height));
  return (
    <IconButton
      size="sm"
      icon={icon}
      label={label}
      disabled={disabled}
      onClick={(e: MouseEvent<HTMLButtonElement>) =>
        link.onClick?.(e as unknown as MouseEvent<HTMLAnchorElement>)
      }
    />
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
        <EmptyState icon={Blocks} title="No such block" pattern>
          {asHeight !== null
            ? `Block ${formatInt(asHeight)} is not in the chain this server knows.`
            : 'No block has this hash on the chain this server knows.'}
        </EmptyState>
      );
    }
    return (
      <ErrorState error={q.error} title="Could not load this block" onRetry={() => void q.refetch()}>
        The explorer did not answer. The block is fine; try again in a moment.
      </ErrorState>
    );
  }

  const b = d.block;
  const final = q.confirmations >= 10;
  const kindWord =
    b.kind === 'pon' ? 'Proof of Node' : b.kind === 'pow' ? 'Proof of Work' : 'Unknown consensus';
  const hasPrev = b.height > 0;
  const hasValue = d.txs.some((t) => t.kind !== 'coinbase');
  return (
    <div>
      <ViewHeader
        kind="Block"
        icon={Blocks}
        title={formatHeight(b.height)}
        mono
        subtitle={
          <>
            {formatInt(b.tx_count)} transactions{b.size > 0 ? `, ${formatBytes(b.size)}` : ''}, produced{' '}
            <RelativeTime ts={b.time_ms} />
          </>
        }
        freshness={final ? undefined : <StatusChip status="live" label="Following the chain" />}
        actions={
          <>
            <StepButton height={b.height - 1} label="Previous block" icon={ChevronLeft} disabled={!hasPrev} />
            <StepButton
              height={b.height + 1}
              label={q.hasNext ? 'Next block' : 'Next block (not mined yet)'}
              icon={ChevronRight}
            />
          </>
        }
      >
        <ConfirmationGauge confirmations={q.confirmations} />
        <Chip>{kindWord}</Chip>
        <Chip icon={Clock} mono>
          {formatUtcDateTime(b.time_ms)}
        </Chip>
      </ViewHeader>

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
      {hasValue ? null : (
        <Section title="Transactions">
          <p className="ex-muted">
            This block holds only its coinbase
            {d.txs.some((t) => t.kind === 'coinbase') ? (
              <>
                {', '}
                <EntityLink kind="tx" value={d.txs.find((t) => t.kind === 'coinbase')?.txid} />
              </>
            ) : null}
            .
          </p>
        </Section>
      )}

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
                <Unknown>Not mined yet</Unknown>
              ),
            },
            { label: 'Version', value: formatInt(d.version), mono: true },
            { label: 'Value out', value: <Amount value={d.value_out} decimals={8} /> },
            { label: 'Dev fund output', value: <Amount value={d.dev_fund} decimals={8} /> },
            {
              label: 'Producer collateral',
              value: d.producer_collateral ? (
                <Hash value={d.producer_collateral} full copy="hover" what="collateral" />
              ) : null,
            },
          ]}
        />
      </Section>
    </div>
  );
}
