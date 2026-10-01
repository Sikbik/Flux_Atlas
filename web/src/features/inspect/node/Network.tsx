import { useMemo } from 'react';
import type { PeerDto } from '../../../api/generated/PeerDto';
import { useNodePeers } from '../../../api/queries';
import { useRuntime } from '../../../app/context';
import { formatAgo, formatUtcDateTime, parseEndpoint } from '../../../lib/format';
import { useUi } from '../../../store/ui';
import { EntityLink, Hash, Skeleton, StatusChip, Switch, tierLabel } from '../../../ui';
import { useHostRows, useMeshLayer } from '../sources/hooks';
import { LADDER_PORTS, useHostLive } from '../sources/host';
import { HostLadder } from '../ui';
import { useNodeCtx } from './context';
import { SubHead } from './SubHead';

// ---- host ---------------------------------------------------------------------------------------------

/** The host's eight UPnP ports with the node on each, and who is paid. */
function HostPart() {
  const { ip, id } = useNodeCtx();
  const { live, other } = useHostLive(ip);
  const { rows } = useHostRows(ip);
  if (!ip) return null;

  const used = live.length;
  const addresses = new Set(rows.map((r) => r.payment_address).filter(Boolean));
  const single = addresses.size === 1 ? [...addresses][0]! : null;

  return (
    <div>
      <SubHead
        title={
          <>
            Host <EntityLink kind="host" value={ip} />
          </>
        }
        note={`${used} of ${LADDER_PORTS.length} ports in use`}
      />
      <HostLadder ip={ip} selectedId={id} />
      {other.length ? (
        <p className="ix-cap">
          Also on{' '}
          {other.map((n, i) => (
            <span key={n.id}>
              {i ? ', ' : ''}
              <EntityLink kind="node" value={n.endpoint || String(n.id)}>
                :{parseEndpoint(n.endpoint)?.port ?? '?'}
              </EntityLink>{' '}
              ({n.tier === 'unknown' ? 'unknown tier' : tierLabel(n.tier)})
            </span>
          ))}
          .
        </p>
      ) : null}
      <p className="ix-cap">
        {used <= 1 ? (
          'One node on this host.'
        ) : single ? (
          <>
            All {used} nodes pay <Hash value={single} head={6} tail={4} copy={false} what="payment address" />
            . One host, one point of failure.{' '}
            <EntityLink kind="operator" value={single}>
              View operator
            </EntityLink>
          </>
        ) : addresses.size > 1 ? (
          <>
            {used} nodes on this host, paid to {addresses.size} addresses.{' '}
            <EntityLink kind="host" value={ip}>
              Open the host
            </EntityLink>
          </>
        ) : (
          `${used} nodes on this host.`
        )}
      </p>
    </div>
  );
}

// ---- reachability -------------------------------------------------------------------------------------

/** The node's reachability from the stats round, and whether Atlas is probing it live. */
function ReachPart() {
  const { id, node, live } = useNodeCtx();
  const { clock } = useRuntime();
  const watched = useUi((s) => id !== null && s.watched.includes(id));
  const reachable = live?.reachable ?? node?.reachable ?? null;
  const now = clock.now();
  // The server stamps this only when a stats round reaches the node (a failed round sets `reachable` to false and
  // leaves the stamp alone), so it reads "last reached", and an unreachable node with none has never been reached.
  const swept = node?.last_swept_ms ?? null;
  const sweepLine =
    reachable === false
      ? swept
        ? `The last stats round could not reach it. It was last reached ${formatAgo(now - swept)}.`
        : 'No stats round has reached it yet.'
      : swept
        ? `Last checked ${formatAgo(now - swept)}.`
        : 'Not checked in a stats round yet.';

  return (
    <div>
      <SubHead title="Reachability" />
      <div className="ix-chips">
        {reachable === true ? (
          <StatusChip size="sm" status="confirmed" label="Reachable" />
        ) : reachable === false ? (
          <StatusChip size="sm" status="unreachable" />
        ) : (
          <StatusChip size="sm" status="unknown" label="Not checked yet" />
        )}
        {watched ? (
          <StatusChip
            size="sm"
            status="live"
            label="Probing live"
            title="Atlas probes this node ahead of the regular sweep"
          />
        ) : null}
      </div>
      <p className="ix-cap">
        {sweepLine}
        {node
          ? ` First seen ${formatUtcDateTime(node.first_seen_ms)}; last seen ${formatAgo(now - node.last_seen_ms)}.`
          : ''}
        {watched ? '' : ' Watch the node to probe it live.'}
      </p>
    </div>
  );
}

// ---- mesh ---------------------------------------------------------------------------------------------

const R_OUT = 44;
const R_IN = 26;

function PeerDiagram({ peers }: { peers: readonly PeerDto[] }) {
  const out = peers
    .filter((p) => p.direction === 'outbound' || p.direction === 'both' || p.direction === 'unknown')
    .slice(0, 40);
  const inn = peers.filter((p) => p.direction === 'inbound').slice(0, 32);
  return (
    <svg
      className="ix-peers-svg"
      viewBox="0 0 112 112"
      role="img"
      aria-label={`${out.length} outbound and ${inn.length} inbound peers`}
    >
      <circle cx="56" cy="56" r={R_OUT} className="ix-pg-ring" />
      <circle cx="56" cy="56" r={R_IN} className="ix-pg-ring ix-pg-ring-in" />
      {out.map((p, i) => {
        const a = (i / out.length) * Math.PI * 2 - Math.PI / 2;
        const x = 56 + Math.cos(a) * R_OUT;
        const y = 56 + Math.sin(a) * R_OUT;
        return (
          <g key={`o${p.endpoint}`}>
            <line x1="56" y1="56" x2={x.toFixed(1)} y2={y.toFixed(1)} className="ix-pg-spoke" />
            <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="2.4" className="ix-pg-out" />
          </g>
        );
      })}
      {inn.map((p, i) => {
        const a = (i / inn.length) * Math.PI * 2 - Math.PI / 2 + 0.08;
        return (
          <circle
            key={`i${p.endpoint}`}
            cx={(56 + Math.cos(a) * R_IN).toFixed(1)}
            cy={(56 + Math.sin(a) * R_IN).toFixed(1)}
            r="2.1"
            className="ix-pg-in"
          />
        );
      })}
      <circle cx="56" cy="56" r="6" className="ix-pg-core" />
      <circle cx="56" cy="56" r="10" className="ix-pg-halo" />
    </svg>
  );
}

/** Peer links from the topology sweep, with the switch that reveals them on the globe. */
function MeshPart() {
  const { apiKey, node } = useNodeCtx();
  const q = useNodePeers(apiKey);
  const mesh = useMeshLayer();
  const { clock } = useRuntime();
  const peers = q.data?.peers ?? [];
  const outCount = node?.peers_out ?? peers.filter((p) => p.direction !== 'inbound').length;
  const inCount = node?.peers_in ?? peers.filter((p) => p.direction === 'inbound').length;
  const on = mesh.mode !== 'off';
  const now = clock.now();
  const nearest = useMemo(
    () =>
      peers
        .filter((p) => p.latency_ms !== null)
        .sort((a, b) => (a.latency_ms ?? 0) - (b.latency_ms ?? 0))
        .slice(0, 4),
    [peers],
  );

  return (
    <div>
      {/* No links recorded is not a measured zero, so the count is left out and the line below says so. */}
      <SubHead title="Mesh" note={outCount + inCount > 0 ? `${outCount} out, ${inCount} in` : undefined} />
      <div className="ix-peers">
        {q.isPending ? <Skeleton w={112} circle /> : <PeerDiagram peers={peers} />}
        <div className="ix-peers-side">
          <Switch
            checked={on}
            onChange={(v) => mesh.set(v ? 'sel' : 'off')}
            label="Reveal peers on the globe"
          />
          {q.isPending ? (
            <>
              <Skeleton h={14} />
              <Skeleton h={14} w="80%" />
              <Skeleton h={14} w="70%" />
            </>
          ) : nearest.length ? (
            nearest.map((p) => (
              <div className="ix-peer" key={p.endpoint}>
                {p.id !== null ? (
                  <EntityLink kind="node" value={p.endpoint} />
                ) : (
                  <span className="ui-mono">{p.endpoint}</span>
                )}
                <em className="ui-mono ix-dim">{p.latency_ms?.toFixed(0)} ms</em>
              </div>
            ))
          ) : (
            <p className="ix-cap">
              {peers.length === 0
                ? 'No peer links recorded for this node yet.'
                : 'Peer latencies are not known yet.'}
            </p>
          )}
        </div>
      </div>
      <p className="ix-cap">
        Filled dots are peers this node connects to, hollow dots connect to it
        {q.data?.swept_ms ? `. Swept ${formatAgo(now - q.data.swept_ms)}` : ''}.
      </p>
    </div>
  );
}

/** The host, how the node is reached, and who it talks to. */
export function NetworkBody() {
  return (
    <div className="ix-stack ix-stack-lg">
      <HostPart />
      <ReachPart />
      <MeshPart />
    </div>
  );
}
