// /address/$addr: a wallet as a place. The balance as the one headline, what the address is (known
// entities carry a label and a note), its history, the nodes it is paid for and when, its unspent
// outputs. Everything updates as blocks land.

import { Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useRichList } from '../../../api/queries';
import { usePrice } from '../../../app/context';
import { formatInt, formatSats, parseFlux } from '../../../lib/format';
import {
  Amount,
  AnimatedNumber,
  Chip,
  CopyButton,
  EmptyState,
  ErrorState,
  formatAmountText,
  Row,
  Section,
  Skeleton,
  Stat,
  StatGrid,
  StatusChip,
  TabPanel,
  Tabs,
  ViewHeader,
} from '../../../ui';
import { isNotFound, useAddressData, useAddressNodes } from '../hooks/useExplorerData';
import { knownEntity } from '../lib/entities';
import { AddressNodesTab, AddressOverview } from './address/AddressOverview';
import { AddressTxList } from './address/AddressTxList';
import { AddressUtxos } from './address/AddressUtxos';
import { RouteLink } from './shared';
import './address/address.css';
import './view.css';

type TabId = 'overview' | 'txs' | 'nodes' | 'utxos';

const KIND: Record<string, string> = {
  p2pkh: 'P2PKH address',
  p2sh: 'P2SH address',
  sapling: 'Shielded (Sapling)',
  sprout: 'Shielded (Sprout)',
  unknown: 'Unrecognised format',
};

/** A headline balance: cents only while they still matter; a six-figure balance reads in whole FLUX. */
const fluxFigure = (v: number) =>
  formatSats(BigInt(Math.round(v * 1e8)), { decimals: Math.abs(v) >= 10_000 ? 0 : 2, unit: false });

function AddressSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading address">
      <ViewHeader kind="Address" icon={Wallet} title={<Skeleton w={300} h={26} radius={6} />}>
        <Skeleton w={120} h={22} radius={11} />
        <Skeleton w={150} h={22} radius={11} />
      </ViewHeader>
      <div className="ex-hero">
        <StatGrid min={150}>
          <Stat hero label="Balance" loading />
          <Stat label="Received" loading />
          <Stat label="Sent" loading />
        </StatGrid>
      </div>
      <Section title="Balance over time">
        <Skeleton h={220} radius={12} />
      </Section>
    </div>
  );
}

export function AddressView({ addr }: { addr: string }) {
  const q = useAddressData(addr);
  const price = usePrice();
  const rich = useRichList();
  const nodes = useAddressNodes(addr);
  const [tab, setTab] = useState<TabId>('overview');
  const d = q.data;

  const rank = useMemo(() => {
    const e = rich.data?.entries.find((x) => x.address === addr);
    return e ? { rank: e.rank, share: e.share_pct } : null;
  }, [rich.data, addr]);

  if (q.isPending) return <AddressSkeleton />;
  if (!d) {
    if (isNotFound(q.error)) {
      return (
        <EmptyState icon={Wallet} title="No such address" pattern>
          This is not an address the explorer can read. Check the characters: a Flux address starts with t1 or
          t3.
        </EmptyState>
      );
    }
    return (
      <ErrorState error={q.error} title="Could not load this address" onRetry={() => void q.refetch()}>
        The explorer did not answer. The address is fine; try again in a moment.
      </ErrorState>
    );
  }

  const entity = knownEntity(addr);
  const balance = parseFlux(d.balance) ?? 0n;
  const pending = parseFlux(d.unconfirmed_balance) ?? 0n;
  const usd = price ? (Number(balance) / 1e8) * price.usd : null;
  const nodeTotal = d.node_counts.total;
  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'txs' as const, label: 'Transactions', badge: formatInt(d.tx_count) },
    ...(nodeTotal > 0 ? [{ id: 'nodes' as const, label: 'Nodes', badge: formatInt(nodeTotal) }] : []),
    { id: 'utxos' as const, label: 'Unspent' },
  ];
  const tabsId = `addr-${addr.slice(0, 8)}`;
  const active: TabId = tabs.some((t) => t.id === tab) ? tab : 'overview';

  return (
    <div>
      <ViewHeader
        kind="Address"
        icon={Wallet}
        title={d.address}
        mono
        subtitle={entity ? `${entity.label}. ${entity.note}` : undefined}
        freshness={
          <Row gap={3} wrap={false}>
            <StatusChip status="live" label="Following the chain" />
            <CopyButton size="md" value={d.address} what="address" />
          </Row>
        }
      >
        <Chip>{KIND[d.kind] ?? d.kind}</Chip>
        {entity ? <Chip tone="accent">{entity.label}</Chip> : null}
        {rank ? (
          <Chip>
            <RouteLink to="/richlist">Rich list #{formatInt(rank.rank)}</RouteLink>
          </Chip>
        ) : null}
        {nodeTotal > 0 ? <Chip mono>{formatInt(nodeTotal)} nodes</Chip> : null}
        {nodes.data && nodes.data.nodes.length === 0 && nodeTotal > 0 ? <Chip>Nodes not listed</Chip> : null}
        {pending !== 0n ? (
          <Chip title="On its way and not in the balance yet">
            Unconfirmed <Amount value={pending} decimals={2} sign="always" tone="signed" />
          </Chip>
        ) : null}
      </ViewHeader>

      <div className="ex-hero">
        <StatGrid min={150}>
          <Stat
            hero
            label="Balance"
            value={<AnimatedNumber value={Number(balance) / 1e8} format={fluxFigure} maxHz={2} />}
            unit="FLUX"
            caption={
              usd !== null
                ? `about $${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(usd)} at the current price (estimate)`
                : undefined
            }
          />
          <Stat
            label="Received"
            value={formatAmountText(d.received, { decimals: 0 })}
            unit="FLUX"
            caption="in total"
          />
          <Stat
            label="Sent"
            value={formatAmountText(d.sent, { decimals: 0 })}
            unit="FLUX"
            caption="in total"
          />
        </StatGrid>
      </div>

      <div className="ex-tabs">
        <Tabs items={tabs} value={active} onChange={setTab} aria-label="Address sections" id={tabsId} />
      </div>

      <TabPanel tabsId={tabsId} id="overview" value={active}>
        <AddressOverview addr={addr} data={d} onOpenNodes={() => setTab('nodes')} />
      </TabPanel>
      <TabPanel tabsId={tabsId} id="txs" value={active}>
        <Section title="Transactions" aside={`${formatInt(d.tx_count)} in total`} flush>
          <AddressTxList addr={addr} />
        </Section>
      </TabPanel>
      <TabPanel tabsId={tabsId} id="nodes" value={active}>
        <AddressNodesTab addr={addr} counts={d.node_counts} />
      </TabPanel>
      <TabPanel tabsId={tabsId} id="utxos" value={active}>
        <Section title="Unspent outputs" flush>
          <AddressUtxos addr={addr} />
        </Section>
      </TabPanel>
    </div>
  );
}
