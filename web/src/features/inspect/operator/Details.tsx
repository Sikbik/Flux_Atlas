// What sits behind the lead: FluxOS versions, hardware, apps and the address. Each is a folded section
// whose one-line summary already answers "is it fine?", so the view stays short until a reader asks.

import { useQuery } from '@tanstack/react-query';
import { AppWindow, Cpu, Fingerprint, GitBranch, RotateCw } from 'lucide-react';
import { useMemo } from 'react';
import { useNetworkVersions } from '../../../api/queries';
import { formatInt } from '../../../lib/format';
import {
  Amount,
  BarList,
  type BarListItem,
  Button,
  Endpoint,
  EntityLink,
  Hash,
  KeyValue,
  Row,
  Skeleton,
} from '../../../ui';
import { type FleetNode, hardwareMix, stragglers, type TierMix, versionCounts } from '../derive/operator';
import { latestVersion } from '../derive/versions';
import { watchNodeQuery } from '../sources/watchRoster';
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

/** Rows shown before "Show all": the busiest nodes. */
const APPS_SHOWN = 8;

/**
 * What runs on one node, read from its detail record when its row opens. The record is the watchlist's own
 * (same query), so a watched node is never asked for twice.
 */
function NodeApps({ node }: { node: FleetNode }) {
  const q = useQuery({ ...watchNodeQuery(node.id), enabled: node.present });
  const link = node.outpoint || node.endpoint || String(node.id);
  if (!node.present) return <p className="ix-cap">This node has left the network.</p>;
  if (q.isPending) return <Skeleton h={26} w="70%" />;
  if (q.isError || !q.data) {
    return (
      <p className="ix-cap ix-node-apps-error">
        Its apps did not load.{' '}
        <Button size="sm" variant="ghost" icon={RotateCw} onClick={() => void q.refetch()}>
          Try again
        </Button>
      </p>
    );
  }
  const apps = q.data.apps;
  return (
    <div className="ix-node-apps">
      {apps.length ? (
        <div className="ix-links">
          {apps.map((a) => (
            <EntityLink key={a.name} kind="app" value={a.name} icon>
              {a.display_name || a.name}
            </EntityLink>
          ))}
        </div>
      ) : (
        <p className="ix-cap">No apps run on this node now.</p>
      )}
      <EntityLink kind="node" value={link} className="ix-node-apps-open">
        Open the node
      </EntityLink>
    </div>
  );
}

export function AppsFold({ nodes, open }: { nodes: readonly FleetNode[]; open: OpenSet }) {
  const hosting = useMemo(
    () => nodes.filter((n) => n.appCount > 0).sort((a, b) => b.appCount - a.appCount || a.id - b.id),
    [nodes],
  );
  const byId = useMemo(() => new Map(hosting.map((n) => [String(n.id), n])), [hosting]);
  const total = hosting.reduce((a, n) => a + n.appCount, 0);
  const items: BarListItem[] = hosting.map((n) => ({
    id: String(n.id),
    label: n.endpoint || `Node ${n.id}`,
    value: n.appCount,
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
        limit={APPS_SHOWN}
        labelWidth={150}
        emptyText="No node of this fleet runs an app."
        renderOpen={(item) => {
          const n = byId.get(item.id);
          return n ? <NodeApps node={n} /> : null;
        }}
      />
      {hosting.length > 0 ? <p className="ix-cap">Expand a node to list its apps.</p> : null}
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
