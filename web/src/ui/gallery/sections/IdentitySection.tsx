import {
  Amount,
  Endpoint,
  EntityLink,
  Hash,
  Height,
  KeyValue,
  RelativeTime,
  StatusChip,
  TierChip,
} from '../../index';
import { useGalleryData } from '../data';
import { GallerySection, SpecGrid, Specimen } from '../primitives';

/** Gallery section: Hash, Amount, Height, RelativeTime, Endpoint and EntityLink. */
export function IdentitySection() {
  const { blocks, node, host, apps, txs, network } = useGalleryData();
  const tip = blocks?.[0];
  const app = apps?.[0];
  const txid = txs?.[0]?.txid ?? null;
  const payout = tip?.payouts[0];

  return (
    <GallerySection
      id="identity"
      title="Identity atoms"
      lead="How the network's nouns are written. Hashes are middle-truncated in Plex Mono and still copy whole; amounts keep their precision and a dim unit; times are live on the shared clock; every entity is a link to its page."
    >
      <SpecGrid min={380}>
        <Specimen
          title="Hash."
          caption="Head and tail with a hairline gap, the full value in the title and in the DOM so a drag-select copies all of it. The copy button appears on hover and focus, and always on touch."
          layout="stack"
        >
          <Hash value={tip?.hash} what="block hash" />
          <Hash value={tip?.hash} head={10} tail={8} copy="always" what="block hash" />
          <Hash value={txid} copy={false} />
          <Hash value={tip?.hash} full what="block hash" />
          <Hash value={null} />
        </Specimen>
        <Specimen
          title="Amount."
          caption="FLUX through the shared formatter: two decimals in summaries, eight with the trailing zeros dimmed for transactions. Signed tints gains and losses; the sign is the second cue."
          layout="stack"
        >
          <Amount value={tip?.reward} />
          <Amount value={tip?.reward} exact />
          <Amount value={payout?.amount} sign="always" tone="signed" />
          <Amount value="-123.45600000" tone="signed" />
          <Amount value={network?.supply?.total} decimals={0} />
          <Amount value={tip?.fees} unit={false} tone="hot" />
          <Amount value={null} />
        </Specimen>
        <Specimen
          title="Height and RelativeTime."
          caption="Heights group digits and link to their block. Times tick on the shared 1 Hz clock without a timer each, and carry the full UTC time in the title."
          layout="stack"
        >
          <div className="kg-row">
            <Height value={tip?.height} />
            <Height value={tip ? tip.height - 1 : null} link={false} />
            <Height value={null} />
          </div>
          <div className="kg-row">
            <RelativeTime ts={tip?.time_ms} />
            <RelativeTime ts={blocks?.[4]?.time_ms} />
            <RelativeTime ts={blocks?.[4]?.time_ms} ageOnly />
            <RelativeTime ts={null} />
          </div>
        </Specimen>
        <Specimen
          title="Endpoint."
          caption="IP and port in Plex Mono, IPv6 bracketed, linked to the node (with a port) or the host (without). The default Flux port can be dropped."
          layout="stack"
        >
          <Endpoint value={node?.endpoint} copy />
          <Endpoint value={node?.endpoint} hideDefaultPort />
          <Endpoint ip={host} />
          <Endpoint value="[2a01:4f8:1c1b:5d4::1]:16147" />
          <Endpoint value={null} />
        </Specimen>
        <Specimen
          title="EntityLink."
          caption="Every kind of noun resolves to its route and keeps the current camera, layers and filters in the URL. Add an icon, a copy button or a hover preview."
          layout="stack"
          span={2}
        >
          <div className="kg-row" style={{ gap: 'var(--space-6)' }}>
            <EntityLink kind="node" value={node?.endpoint} icon />
            <EntityLink kind="host" value={host} icon />
            <EntityLink kind="app" value={app?.name} icon>
              {app?.display_name}
            </EntityLink>
            <EntityLink kind="block" value={tip?.height} icon />
            <EntityLink kind="tx" value={txid} icon />
            <EntityLink kind="address" value={node?.payment_address} icon />
            <EntityLink kind="operator" value={node?.payment_address} icon>
              Operator
            </EntityLink>
            <EntityLink kind="country" value={node?.geo?.country_code} icon>
              {node?.geo?.country}
            </EntityLink>
            <EntityLink kind="provider" value={node?.geo?.org} icon />
            <EntityLink kind="version" value={node?.versions.flux_os} icon />
          </div>
          <div className="kg-row" style={{ gap: 'var(--space-8)' }}>
            <EntityLink kind="tx" value={txid} copy />
            <EntityLink kind="address" value={node?.payment_address} copy="always" />
            <EntityLink
              kind="node"
              value={node?.endpoint}
              icon
              preview={
                node ? (
                  <div className="kg-preview">
                    <div className="kg-row">
                      <TierChip tier={node.tier} size="sm" />
                      <StatusChip status={node.status} size="sm" />
                    </div>
                    <KeyValue
                      items={[
                        { label: 'Rank', value: node.rank, mono: true },
                        {
                          label: 'Location',
                          value: [node.geo?.city, node.geo?.country].filter(Boolean).join(', ') || null,
                        },
                        { label: 'FluxOS', value: node.versions.flux_os, mono: true },
                      ]}
                    />
                  </div>
                ) : null
              }
            />
            <EntityLink kind="node" value={null} />
          </div>
        </Specimen>
      </SpecGrid>
    </GallerySection>
  );
}
