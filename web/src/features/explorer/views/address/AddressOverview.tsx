// The address overview: the balance over time. An address that runs nodes gets one line about them and
// a way into the Nodes tab; the map, the payouts and the list live there.

import { useQuery } from '@tanstack/react-query';
import { Layers, TrendingUp, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import type { AddressDto } from '../../../../api/generated/AddressDto';
import { queries } from '../../../../api/queries';
import { useRuntime } from '../../../../app/context';
import { formatInt, formatSats, parseFlux } from '../../../../lib/format';
import { useNow } from '../../../../lib/useClock';
import { useUi } from '../../../../store/ui';
import {
  Amount,
  Button,
  EntityLink,
  Section,
  ShareBar,
  Stack,
  Stat,
  StatGrid,
  type TierName,
  TimeSeries,
  tierLabel,
} from '../../../../ui';
import { earnedSats } from '../../../earnings/basis';
import { EarningsBasis } from '../../../earnings/EarningsBasis';
import { useCollateral } from '../../hooks/useCollateral';
import { useVisible } from '../../hooks/useDom';
import { useAddressNodes, useAddressTxsLive } from '../../hooks/useExplorerData';
import { balanceSeries, holdSeries, payoutEvents } from '../../lib/addressTxs';
import { axisFormat } from '../../lib/axis';
import { AddressNodesList, NodesMap } from './AddressNodes';
import { PayoutStrip } from './PayoutStrip';
import './address.css';

const HISTORY_TARGET = 200;
const SAMPLES = 240;
const TIERS: TierName[] = ['stratus', 'nimbus', 'cumulus'];

const fluxText = (v: number) => formatSats(BigInt(Math.round(v * 1e8)), { decimals: 2, unit: false });

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
  const chart = useMemo(() => holdSeries(series, now, SAMPLES), [series, now]);
  const axis = useMemo(() => axisFormat(chart.v), [chart.v]);
  const span = complete
    ? `all ${formatInt(q.items.length)} transactions`
    : `the last ${formatInt(q.items.length)} of ${formatInt(txCount)} transactions`;
  return (
    <Section
      title="Balance over time"
      icon={TrendingUp}
      actions={
        !complete && q.hasNextPage ? (
          <Button size="sm" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
            Load older
          </Button>
        ) : undefined
      }
    >
      <div ref={ref}>
        <TimeSeries
          label={`Balance of this address over ${span}`}
          t={chart.t}
          series={[
            { key: 'balance', label: 'Balance', values: chart.v, format: (v) => `${fluxText(v)} FLUX` },
          ]}
          height={220}
          yFormat={axis}
          loading={q.isPending}
          emptyText="This address has no confirmed history to draw yet."
        />
        {q.items.length > 0 ? <p className="ex-caption">Drawn from {span}.</p> : null}
      </div>
    </Section>
  );
}

function NodesTeaser({ counts, onOpen }: { counts: AddressDto['node_counts']; onOpen: () => void }) {
  const collateral = useCollateral();
  const locked = TIERS.reduce((s, t) => s + BigInt(counts[t]) * collateral[t], 0n);
  return (
    <Section
      title="Nodes"
      icon={Layers}
      actions={
        <Button size="sm" onClick={onOpen}>
          See the nodes
        </Button>
      }
    >
      <Stack gap={4}>
        <ShareBar
          label="Nodes of this address by tier"
          segments={TIERS.filter((t) => counts[t] > 0).map((t) => ({
            id: t,
            label: tierLabel(t),
            value: counts[t],
            tier: t,
          }))}
        />
        <p className="ex-note">
          Together they lock <Amount value={locked} decimals={0} /> of collateral.
        </p>
      </Stack>
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
  return (
    <>
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
  const includePa = useUi((s) => s.includePa);
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
          <EntityLink kind="operator" value={addr}>
            Operator view
          </EntityLink>
        }
      >
        <StatGrid min={150} columns={3}>
          {TIERS.map((t) => (
            <Stat
              key={t}
              tier={t}
              label={tierLabel(t)}
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
          <p className="ex-note ex-after">
            Earned <Amount value={earnedSats(op.earned_24h, op.pa_earned_24h, includePa)} decimals={2} /> in
            the last 24 hours
            {op.earned_30d !== op.earned_24h ? (
              <>
                {' '}
                and <Amount value={earnedSats(op.earned_30d, op.pa_earned_30d, includePa)} decimals={2} /> in
                30 days
              </>
            ) : null}
            , counted from the blocks this server has seen. <EarningsBasis size="sm" realized />
          </p>
        ) : null}
      </Section>
      <Section title="Where they run" collapsible defaultOpen>
        {nodes.data ? <NodesMap nodes={nodes.data.nodes} /> : null}
      </Section>
      <Section
        title="Payouts"
        icon={Zap}
        collapsible
        defaultOpen={false}
        aside={events.length > 0 ? `${formatInt(events.length)} loaded` : undefined}
      >
        <PayoutStrip events={events} now={now} />
      </Section>
      <Section title="All nodes" aside={`${formatInt(counts.total)}`} flush>
        <AddressNodesList nodes={nodes.data?.nodes} loading={nodes.isPending} />
      </Section>
    </>
  );
}
