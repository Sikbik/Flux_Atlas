import { formatBytes, formatFlux, formatInt, shortAddress } from '../../../lib/format';
import {
  Delta,
  Endpoint,
  EntityLink,
  Hash,
  Height,
  KeyValue,
  type KeyValueItem,
  RelativeTime,
  Sparkline,
  Stat,
  StatGrid,
  StatusChip,
  TierChip,
} from '../../index';
import { useGalleryData } from '../data';
import { GallerySection, SpecGrid, Specimen } from '../primitives';

/** Gallery section: Stat tiles, Delta and KeyValue lists on real node and block data. */
export function ReadoutsSection() {
  const { network, tiers, blocks, node, nodeSeries, priceSeries } = useGalleryData();
  const tip = blocks?.[0];
  const prev = blocks?.[1];
  const price = network?.price;
  const stratus = tiers?.find((t) => t.tier === 'stratus');
  const txDelta = tip && prev ? tip.tx_count - prev.tx_count : null;
  const sizeDelta = tip && prev && prev.size > 0 ? ((tip.size - prev.size) / prev.size) * 100 : null;

  const nodeRows: KeyValueItem[] = [
    { label: 'Endpoint', value: node ? <Endpoint value={node.endpoint} copy /> : null },
    { label: 'Tier', value: node ? <TierChip tier={node.tier} size="sm" /> : null },
    { label: 'Status', value: node ? <StatusChip status={node.status} size="sm" /> : null },
    {
      label: 'Collateral',
      value: node ? <Hash value={node.outpoint} head={8} tail={6} what="collateral outpoint" /> : null,
    },
    {
      label: 'Payment address',
      value: node ? (
        <EntityLink kind="address" value={node.payment_address} copy>
          {shortAddress(node.payment_address)}
        </EntityLink>
      ) : null,
    },
    { label: 'Rank', value: node?.rank ?? null, mono: true },
    { label: 'Confirmed at', value: node ? <Height value={node.confirmed_height} /> : null },
    { label: 'Last paid', value: node ? <Height value={node.last_paid_height} /> : null },
    { label: 'Active since', value: node ? <RelativeTime ts={node.active_since_ms} /> : null },
    { label: 'FluxOS', value: node?.versions.flux_os ?? null, mono: true },
    { label: 'Reachable', value: node?.reachable == null ? null : node.reachable ? 'Yes' : 'No' },
    { label: 'Benchmark note', value: node?.hardware?.bench_error ?? null, unknown: 'None reported' },
  ];

  return (
    <GallerySection
      id="readouts"
      title="Readouts"
      lead="Numbers are the product. A Stat shows one figure with its unit, its change and one line of context; a KeyValue lists facts against a label column. A figure that has not arrived says Unknown, never 0, and a change always names its period."
    >
      <SpecGrid min={400}>
        <Specimen
          title="Stat."
          caption="Label, tabular figure, optional unit, delta and caption. Figures come from the live server; deltas are measured against the previous block or the 24 h price window."
          span={2}
        >
          <StatGrid min={170} style={{ width: '100%' }}>
            <Stat
              label="Nodes"
              value={network ? formatInt(network.node_count) : undefined}
              loading={!network}
              caption={network ? `${formatInt(network.host_count)} IP addresses` : undefined}
              spark={nodeSeries ? <Sparkline values={nodeSeries} decorative /> : undefined}
            />
            <Stat
              label="Block reward"
              value={network ? formatFlux(network.reward, { unit: false }) : undefined}
              unit="FLUX"
              loading={!network}
              caption="to the four payout outputs"
            />
            <Stat
              label="FLUX price"
              value={price ? `$${price.usd.toFixed(4)}` : undefined}
              loading={!network}
              delta={price ? <Delta kind="percent" value={price.change_24h_pct} period="24 h" /> : null}
              spark={priceSeries ? <Sparkline values={priceSeries} decorative /> : undefined}
            />
            <Stat
              label="Transactions in tip block"
              value={tip ? formatInt(tip.tx_count) : undefined}
              loading={!tip}
              delta={txDelta === null ? null : <Delta value={txDelta} period="vs previous block" />}
            />
            <Stat
              label="Tip block size"
              value={tip ? formatBytes(tip.size) : undefined}
              loading={!tip}
              delta={
                sizeDelta === null ? null : <Delta kind="percent" value={sizeDelta} period="vs previous" />
              }
            />
          </StatGrid>
        </Specimen>
        <Specimen
          title="Stat states."
          caption="Loading keeps the tile geometry. Stale says No data with the reason, Unknown keeps the word, a tier tint lights the corner, and a tile with an action is a single button."
          span={2}
        >
          <StatGrid min={170} style={{ width: '100%' }}>
            <Stat label="Nodes" loading />
            <Stat label="FLUX price" stale="Price feed has not answered for 14 min" />
            <Stat label="Collateral requirement" value={null} />
            <Stat
              label="Stratus nodes"
              tier="stratus"
              value={stratus ? formatInt(stratus.count) : undefined}
              loading={!stratus}
              caption={stratus ? `${formatFlux(stratus.payout)} per block` : undefined}
            />
            <Stat
              label="Open the explorer"
              value={tip ? formatInt(tip.height) : undefined}
              loading={!tip}
              caption="Click to open the tip block"
              onClick={() => undefined}
            />
          </StatGrid>
        </Specimen>
        <Specimen
          title="Delta."
          caption="An arrow, a sign and a colour, in Plex Mono, with the period in words. A change that rounds to zero is flat; a missing one is Unknown. Illustrative values, except the real 24 h price change."
        >
          <Delta value={23} period="today" />
          <Delta value={-1204} period="vs last week" />
          <Delta value={price?.change_24h_pct ?? null} kind="percent" period="24 h" />
          <Delta value={0} period="this hour" />
          <Delta value={0.004} kind="percent" period="this hour" />
          <Delta value={null} period="today" />
        </Specimen>
        <Specimen
          title="KeyValue, inspector."
          caption="Right-aligned values against a label column, in a 420 px inspector. Hashes truncate in the middle, links keep their copy buttons, and a missing value is Unknown."
          width={420}
        >
          <KeyValue items={nodeRows} aria-label="Node facts" />
        </Specimen>
        <Specimen
          title="KeyValue, explorer."
          caption="Left-aligned and ruled for wide panes, with a fixed label column."
          width={640}
        >
          <KeyValue
            align="start"
            ruled
            labelWidth={150}
            aria-label="Block facts"
            items={[
              { label: 'Height', value: tip ? <Height value={tip.height} link={false} /> : null },
              {
                label: 'Hash',
                value: tip ? (
                  <Hash value={tip.hash} head={14} tail={10} what="block hash" copy="always" />
                ) : null,
              },
              { label: 'Mined', value: tip ? <RelativeTime ts={tip.time_ms} /> : null },
              { label: 'Transactions', value: tip?.tx_count ?? null },
              { label: 'Size', value: tip ? formatBytes(tip.size) : null, mono: true },
              {
                label: 'Producer node',
                value: tip?.producer == null ? null : <EntityLink kind="node" value={tip.producer} icon />,
                note: 'Opens the node that produced the block',
              },
              { label: 'Pool', value: null, unknown: 'Not reported' },
            ]}
          />
        </Specimen>
      </SpecGrid>
    </GallerySection>
  );
}
