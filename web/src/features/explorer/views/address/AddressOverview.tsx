// The address overview: three totals and the balance over time. An address that runs nodes gets one
// line about them and a way into the Nodes tab; the map, the payouts and the list live there.

import { useQuery } from '@tanstack/react-query';
import { Layers, TrendingUp, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import type { AddressDto } from '../../../../api/generated/AddressDto';
import { queries } from '../../../../api/queries';
import { useRuntime } from '../../../../app/context';
import { formatInt, formatSats, parseFlux } from '../../../../lib/format';
import { useNow } from '../../../../lib/useClock';
import { TimeChart } from '../../../analytics/viz/TimeChart';
import { useVisible } from '../../hooks/useDom';
import { useAddressNodes, useAddressTxsLive } from '../../hooks/useExplorerData';
import { balanceSeries, payoutEvents, thinPoints } from '../../lib/addressTxs';
import { knownEntity } from '../../lib/entities';
import {
  Amount,
  Button,
  Chip,
  CompactAmount,
  EntityLink,
  Section,
  Skeleton,
  Stat,
  StatGrid,
  TIER_LABEL,
  TierGlyph,
  type TierName,
} from '../../parts';
import { AddressNodesList, NodesMap, useCollateral } from './AddressNodes';
import { PayoutStrip } from './PayoutStrip';
import './address.css';

const HISTORY_TARGET = 200;
const TIERS: TierName[] = ['stratus', 'nimbus', 'cumulus'];

function BalanceSection({ addr, balance, txCount }: { addr: string; balance: bigint; txCount: number }) {
  const q = useAddressTxsLive(addr, 50);
  const ref = useRef<HTMLDivElement>(null);
  const seen = useVisible(ref, { once: true });
  // Pull a few pages so the chart has a history to draw; more on request.
  useEffect(() => {
    if (seen && q.hasNextPage && !q.isFetchingNextPage && q.items.length < HISTORY_TARGET)
      void q.fetchNextPage();
  }, [seen, q.hasNextPage, q.isFetchingNextPage, q.items.length, q.fetchNextPage]);
  const complete = q.items.length >= txCount && !q.hasNextPage;
  const series = useMemo(
    () => balanceSeries(q.items, addr, balance, complete),
    [q.items, addr, balance, complete],
  );
  const { clock } = useRuntime();
  const now = useNow(clock);
  const chart = useMemo(() => {
    const pts = thinPoints(series.points, 360);
    if (pts.length === 0) return null;
    const t = [...pts.map((p) => p.t), Math.max(now, pts.at(-1)!.t)];
    const v = [...pts.map((p) => p.balance), Number(balance) / 1e8];
    return { t, v };
  }, [series, now, balance]);
  const span = complete
    ? `all ${formatInt(q.items.length)} transactions`
    : `the last ${formatInt(q.items.length)} of ${formatInt(txCount)} transactions`;
  return (
    <Section
      title="Balance over time"
      icon={TrendingUp}
      aside={q.items.length > 0 ? span : undefined}
      actions={
        !complete && q.hasNextPage ? (
          <Button onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {q.isFetchingNextPage ? 'Loading' : 'Load older'}
          </Button>
        ) : undefined
      }
    >
      <div ref={ref}>
        {q.isPending ? (
          <Skeleton h={220} radius={14} />
        ) : chart && chart.t.length > 1 ? (
          <TimeChart
            title="Balance"
            summary={`Balance of this address over ${span}`}
            t={chart.t}
            series={[
              { key: 'balance', label: 'Balance', color: 'var(--viz-1)', values: chart.v, fill: true },
            ]}
            mode="step"
            height={220}
            live
            yFormat={(x) => formatSats(BigInt(Math.round(x * 1e8)), { decimals: 2 })}
            unit="FLUX"
          />
        ) : (
          <p className="ex-muted">Not enough confirmed history to draw a balance curve yet.</p>
        )}
      </div>
    </Section>
  );
}

function NodesTeaser({ counts, onOpen }: { counts: AddressDto['node_counts']; onOpen: () => void }) {
  const collateral = useCollateral();
  const locked = TIERS.reduce((s, t) => s + BigInt(counts[t]) * collateral[t], 0n);
  return (
    <Section title="Nodes" icon={Layers}>
      <div className="ex-teaser">
        <div className="ex-teaser__tiers">
          {TIERS.map((t) =>
            counts[t] > 0 ? (
              <span key={t} className="ex-teaser__tier" data-tier={t}>
                <TierGlyph tier={t} size={15} />
                <b>{formatInt(counts[t])}</b>
                {TIER_LABEL[t]}
              </span>
            ) : null,
          )}
        </div>
        <p className="ex-teaser__text">
          Together they lock <CompactAmount value={locked} /> of collateral.
        </p>
        <Button onClick={onOpen}>See the nodes</Button>
      </div>
    </Section>
  );
}

export function AddressOverview({
  addr,
  data,
  onOpenNodes,
}: {
  addr: string;
  data: AddressDto;
  onOpenNodes: () => void;
}) {
  const balance = parseFlux(data.balance) ?? 0n;
  const entity = knownEntity(addr);
  const pending = parseFlux(data.unconfirmed_balance) ?? 0n;
  return (
    <>
      <Section>
        <StatGrid columns={3}>
          <Stat label="Received" value={<CompactAmount value={data.received} unit={false} />} unit="FLUX" />
          <Stat label="Sent" value={<CompactAmount value={data.sent} unit={false} />} unit="FLUX" />
          <Stat label="Transactions" value={formatInt(data.tx_count)} />
        </StatGrid>
        {pending !== 0n ? (
          <p className="ex-entity-note">
            <Chip>Unconfirmed</Chip>
            <Amount value={pending} decimals={2} sign="always" tone="signed" /> is on its way and not in the
            balance yet.
          </p>
        ) : null}
        {entity ? (
          <p className="ex-entity-note">
            <Chip tone="accent">{entity.label}</Chip> {entity.note}
          </p>
        ) : null}
      </Section>
      <BalanceSection addr={addr} balance={balance} txCount={data.tx_count} />
      {data.node_counts.total > 0 ? <NodesTeaser counts={data.node_counts} onOpen={onOpenNodes} /> : null}
    </>
  );
}

/** The Nodes tab: what the address runs, where, when it was paid, and every node. */
export function AddressNodesTab({ addr, counts }: { addr: string; counts: AddressDto['node_counts'] }) {
  const nodes = useAddressNodes(addr);
  const collateral = useCollateral();
  const operator = useQuery({ ...queries.operator(addr), enabled: counts.total > 0 });
  const tx = useAddressTxsLive(addr, 50);
  const { clock } = useRuntime();
  const now = useNow(clock);
  const events = useMemo(() => payoutEvents(tx.items, addr), [tx.items, addr]);
  const locked = TIERS.reduce((s, t) => s + BigInt(counts[t]) * collateral[t], 0n);
  const op = operator.data;
  return (
    <>
      <Section
        title="Nodes"
        icon={Layers}
        aside={
          <span>
            <Amount value={locked} decimals={0} /> locked
          </span>
        }
        actions={
          <EntityLink kind="operator" value={addr} className="ex-action">
            Operator view
          </EntityLink>
        }
      >
        <StatGrid min={150} columns={3}>
          {TIERS.map((t) => (
            <Stat
              key={t}
              tier={t}
              label={
                <span className="ex-tierlabel">
                  <TierGlyph tier={t} size={14} />
                  {TIER_LABEL[t]}
                </span>
              }
              value={formatInt(counts[t])}
              unit="nodes"
              caption={
                counts[t] > 0 ? (
                  <>
                    locks <Amount value={BigInt(counts[t]) * collateral[t]} decimals={0} />
                  </>
                ) : (
                  'none'
                )
              }
            />
          ))}
        </StatGrid>
        {op ? (
          <p className="ex-note ex-note--below">
            Earned <Amount value={op.earned_24h} decimals={2} /> in the last 24 hours
            {op.earned_30d !== op.earned_24h ? (
              <>
                {' '}
                and <Amount value={op.earned_30d} decimals={2} /> in 30 days
              </>
            ) : null}
            , counted from the blocks this server has seen.
          </p>
        ) : null}
      </Section>
      <Section title="Where they run" collapsible defaultOpen>
        {nodes.isPending ? (
          <Skeleton h={180} radius={14} />
        ) : nodes.data ? (
          <NodesMap nodes={nodes.data.nodes} />
        ) : null}
      </Section>
      <Section
        title="Payouts"
        icon={Zap}
        collapsible
        defaultOpen={false}
        aside={events.length > 0 ? `${formatInt(events.length)} in the loaded transactions` : undefined}
      >
        {tx.isPending ? <Skeleton h={130} radius={14} /> : <PayoutStrip events={events} now={now} />}
      </Section>
      <Section title="All nodes" aside={`${formatInt(counts.total)}`}>
        <AddressNodesList nodes={nodes.data?.nodes} loading={nodes.isPending} />
      </Section>
    </>
  );
}
