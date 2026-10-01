// /address/$addr: a wallet as a place. The balance as a hero numeral, what the address is (known
// entities carry a label and a note), its history, the nodes it is paid for and when, its unspent
// outputs. Everything updates as blocks land.

import { Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useRichList } from '../../../api/queries';
import { usePrice } from '../../../app/context';
import { formatInt, parseFlux } from '../../../lib/format';
import { isNotFound, useAddressData, useAddressNodes } from '../hooks/useExplorerData';
import { knownEntity } from '../lib/entities';
import {
  Chip,
  EmptyState,
  EntityHead,
  ErrorState,
  Hash,
  HeroAmount,
  LiveBadge,
  RouteLink,
  Section,
  Skeleton,
  Stat,
  StatGrid,
  TabPanel,
  Tabs,
} from '../parts';
import { AddressNodesTab, AddressOverview } from './address/AddressOverview';
import { AddressTxList } from './address/AddressTxList';
import { AddressUtxos } from './address/AddressUtxos';
import './address/address.css';

type TabId = 'overview' | 'txs' | 'nodes' | 'utxos';

const KIND: Record<string, string> = {
  p2pkh: 'P2PKH address',
  p2sh: 'P2SH address',
  sapling: 'Shielded (Sapling)',
  sprout: 'Shielded (Sprout)',
  unknown: 'Unrecognised format',
};

function AddressSkeleton() {
  return (
    <div className="ex-root" role="status" aria-busy="true" aria-label="Loading address">
      <EntityHead kind="Address" icon={Wallet} title={<Skeleton w={300} h={46} radius={8} />} loading>
        <Skeleton w={120} h={22} radius={11} />
        <Skeleton w={150} h={22} radius={11} />
      </EntityHead>
      <div style={{ padding: '0 var(--ex-pad)' }}>
        <Skeleton h={36} radius={10} style={{ margin: '14px 0' }} />
      </div>
      <Section>
        <StatGrid>
          {[0, 1, 2].map((i) => (
            <Stat key={i} label={<Skeleton w="50%" h={11} />} loading />
          ))}
        </StatGrid>
      </Section>
      <Section title="Balance over time">
        <Skeleton h={220} radius={14} />
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
        <div className="ex-root">
          <EmptyState icon={Wallet} title="No such address">
            This is not an address the explorer can read. Check the characters: a Flux address starts with t1
            or t3.
          </EmptyState>
        </div>
      );
    }
    return (
      <div className="ex-root">
        <ErrorState title="Could not load this address" onRetry={() => void q.refetch()}>
          The explorer did not answer. The address is fine; try again in a moment.
        </ErrorState>
      </div>
    );
  }

  const entity = knownEntity(addr);
  const balance = parseFlux(d.balance) ?? 0n;
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
    <div className="ex-root">
      <EntityHead
        kind="Address"
        icon={Wallet}
        status="ok"
        aside={<LiveBadge label="Following the chain" />}
        title={
          <HeroAmount
            sats={balance}
            decimals={balance % 1_000_000n === 0n || balance > 1_000_000_000n ? 2 : 8}
          />
        }
        sub={<Hash value={d.address} full copy="always" what="address" />}
      >
        <Chip>{KIND[d.kind] ?? d.kind}</Chip>
        {entity ? (
          <Chip tone="accent" title={entity.note}>
            {entity.label}
          </Chip>
        ) : null}
        {usd !== null ? (
          <Chip mono title="At the current FLUX price; an estimate">
            ≈ ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(usd)}
          </Chip>
        ) : null}
        {rank ? (
          <Chip>
            <RouteLink to="/richlist">Rich list #{formatInt(rank.rank)}</RouteLink>
          </Chip>
        ) : null}
        {nodeTotal > 0 ? <Chip mono>{formatInt(nodeTotal)} nodes</Chip> : null}
        {nodes.data && nodes.data.nodes.length === 0 && nodeTotal > 0 ? <Chip>Nodes not listed</Chip> : null}
      </EntityHead>

      <Tabs items={tabs} value={active} onChange={setTab} label="Address sections" id={tabsId} />

      {active === 'overview' ? (
        <TabPanel tabsId={tabsId} id="overview">
          <AddressOverview addr={addr} data={d} onOpenNodes={() => setTab('nodes')} />
        </TabPanel>
      ) : active === 'txs' ? (
        <TabPanel tabsId={tabsId} id="txs">
          <Section title="Transactions" aside={`${formatInt(d.tx_count)} in total`}>
            <AddressTxList addr={addr} />
          </Section>
        </TabPanel>
      ) : active === 'nodes' ? (
        <TabPanel tabsId={tabsId} id="nodes">
          <AddressNodesTab addr={addr} counts={d.node_counts} />
        </TabPanel>
      ) : (
        <TabPanel tabsId={tabsId} id="utxos">
          <Section title="Unspent outputs">
            <AddressUtxos addr={addr} />
          </Section>
        </TabPanel>
      )}
    </div>
  );
}
