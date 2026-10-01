// What sits behind the lead: FluxOS versions, hardware, apps and the address. Each is a folded section
// whose one-line summary already answers "is it fine?", so the view stays short until a reader asks.

import { AppWindow, Cpu, Fingerprint, GitBranch } from 'lucide-react';
import { useNetworkVersions } from '../../../api/queries';
import { formatInt } from '../../../lib/format';
import { Amount, BarList, type BarListItem, Endpoint, EntityLink, Hash, KeyValue, Row } from '../../../ui';
import { type FleetNode, hardwareMix, stragglers, type TierMix, versionCounts } from '../derive/operator';
import { latestVersion } from '../derive/versions';
import { Fold } from '../ui/fold';
import type { OpenSet } from '../ui/openset';

const gb = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)} TB` : `${formatInt(n)} GB`;

export function VersionsFold({ nodes, open }: { nodes: readonly FleetNode[]; open: OpenSet }) {
  const v = useNetworkVersions();
  const latest = v.data ? latestVersion(v.data.flux_os) : null;
  const counts = versionCounts(nodes);
  const behind = stragglers(nodes, latest);
  const known = counts.filter((c) => c.version !== 'Unknown');
  const summary =
    known.length === 0
      ? 'Unknown'
      : latest === null
        ? `${formatInt(known.length)} ${known.length === 1 ? 'version' : 'versions'}`
        : behind.length === 0
          ? `All on ${latest}`
          : `${formatInt(behind.length)} behind ${latest}`;
  const items: BarListItem[] = counts.map((c) => ({
    id: c.version,
    label: c.version === latest ? `${c.version} (latest)` : c.version,
    value: c.count,
    title: c.version,
    to: c.version === 'Unknown' ? undefined : { kind: 'version', value: c.version },
    color:
      latest !== null && behind.some((b) => b.node.version === c.version) ? 'var(--status-warn)' : undefined,
  }));
  return (
    <Fold id="versions" open={open} title="FluxOS" icon={GitBranch} summary={summary}>
      <BarList label="FluxOS versions in this fleet" items={items} total={nodes.length} labelWidth={132} />
      {behind.length > 0 ? (
        <div className="ix-cap ix-behind">
          <span>Behind:</span>
          <Row gap={4}>
            {behind.slice(0, 4).map((b) => (
              <Endpoint key={b.node.id} value={b.node.endpoint} />
            ))}
            {behind.length > 4 ? (
              <span className="ix-dim">and {formatInt(behind.length - 4)} more</span>
            ) : null}
          </Row>
        </div>
      ) : null}
      {counts.length > 1 ? (
        <p className="ix-cap">
          The latest release is the newest version that a real share of the network runs, so one test build
          never counts.
        </p>
      ) : null}
    </Fold>
  );
}

export function HardwareFold({ nodes, open }: { nodes: readonly FleetNode[]; open: OpenSet }) {
  const mix = hardwareMix(nodes);
  const t = mix.totals;
  const summary =
    mix.groups.length === 0
      ? 'Unknown'
      : `${formatInt(t.cores)} cores · ${gb(t.ramGb)} RAM · ${gb(t.ssdGb)} SSD`;
  const items: BarListItem[] = mix.groups.map((g) => ({
    id: `${g.tier}:${g.cores}:${g.ramGb}:${g.ssdGb}`,
    label: `${g.cores} cores · ${gb(g.ramGb)} · ${gb(g.ssdGb)}`,
    value: g.count,
    display: `${formatInt(g.count)} ${g.count === 1 ? 'node' : 'nodes'}`,
    color: g.tier === 'unknown' ? undefined : `var(--tier-${g.tier})`,
  }));
  return (
    <Fold id="hardware" open={open} title="Hardware" icon={Cpu} summary={summary}>
      <BarList
        label="Hardware configurations"
        items={items}
        total={nodes.length}
        labelWidth="minmax(150px, 52%)"
      />
      {mix.unknown > 0 ? (
        <p className="ix-cap">
          {formatInt(mix.unknown)} {mix.unknown === 1 ? 'node has' : 'nodes have'} no benchmark on record yet,
          so the totals count the rest.
        </p>
      ) : null}
    </Fold>
  );
}

export function AppsFold({ nodes, open }: { nodes: readonly FleetNode[]; open: OpenSet }) {
  const hosting = nodes.filter((n) => n.appCount > 0);
  const total = hosting.reduce((a, n) => a + n.appCount, 0);
  const top = [...hosting].sort((a, b) => b.appCount - a.appCount || a.id - b.id).slice(0, 8);
  const items: BarListItem[] = top.map((n) => ({
    id: String(n.id),
    label: n.endpoint || `Node ${n.id}`,
    value: n.appCount,
    to: n.present ? { kind: 'node', value: n.endpoint || String(n.id) } : undefined,
    color: n.tier === 'unknown' ? undefined : `var(--tier-${n.tier})`,
  }));
  return (
    <Fold
      id="apps"
      open={open}
      title="Apps"
      icon={AppWindow}
      summary={
        total === 0
          ? 'None running'
          : `${formatInt(total)} ${total === 1 ? 'app' : 'apps'} on ${formatInt(hosting.length)} ${hosting.length === 1 ? 'node' : 'nodes'}`
      }
    >
      <BarList
        label="Apps per node"
        items={items}
        labelWidth={150}
        emptyText="No node of this fleet runs an app."
      />
      {hosting.length > top.length ? (
        <p className="ix-cap">
          The {formatInt(top.length)} busiest of {formatInt(hosting.length)} nodes. Open a node for its apps.
        </p>
      ) : null}
    </Fold>
  );
}

export function AddressFold({
  addr,
  collateral,
  tiers,
  open,
}: {
  addr: string;
  collateral: string | null;
  tiers: TierMix & { total?: number };
  open: OpenSet;
}) {
  return (
    <Fold
      id="address"
      open={open}
      title="Address"
      icon={Fingerprint}
      summary={collateral ? <Amount value={collateral} decimals={0} /> : 'Unknown'}
    >
      <KeyValue
        items={[
          {
            label: 'Payment address',
            value: <Hash value={addr} head={10} tail={8} copy="always" what="payment address" />,
          },
          {
            label: 'Collateral locked',
            value: collateral ? <Amount value={collateral} decimals={0} /> : null,
            note: 'across every node of this address',
          },
          {
            label: 'Nodes by tier',
            value: `${formatInt(tiers.stratus)} Stratus, ${formatInt(tiers.nimbus)} Nimbus, ${formatInt(tiers.cumulus)} Cumulus`,
          },
          {
            label: 'Explorer',
            value: (
              <EntityLink kind="address" value={addr} icon>
                Open the address page
              </EntityLink>
            ),
          },
        ]}
      />
    </Fold>
  );
}
