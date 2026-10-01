import { Blocks, Boxes, Hexagon, History, Waypoints } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../api/endpoints';
import type { PeerDto } from '../../../api/generated/PeerDto';
import { useNodePeers } from '../../../api/queries';
import { useChainBlocks, useRuntime, useSummary } from '../../../app/context';
import { formatAgo, formatInt } from '../../../lib/format';
import { useMeshLayer } from '../sources/hooks';
import { readNodeLive } from '../sources/live';
import { AppLink, Block, BlockLink, Btn, Chip, FeedLine, NodeLink, Sk, Switch, TierGlyph } from '../ui';
import { useNodeCtx } from './context';

// ---- peers ------------------------------------------------------------------------------------------

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
export function PeersBlock() {
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
    <Block
      title="Mesh"
      icon={<Waypoints size={14} strokeWidth={1.75} />}
      aside={
        <span className="ix-mono">
          {outCount} out, {inCount} in
        </span>
      }
    >
      <div className="ix-peers">
        {q.isPending ? <Sk w={112} h={112} r={56} /> : <PeerDiagram peers={peers} />}
        <div className="ix-plist-side">
          <div className="ix-switchrow">
            <span className="ix-cap">Reveal peers on the globe</span>
            <Switch
              checked={on}
              onChange={(v) => mesh.set(v ? 'sel' : 'off')}
              label="Reveal peers on the globe"
            />
          </div>
          {q.isPending ? (
            <>
              <Sk h={14} />
              <Sk h={14} w="80%" />
              <Sk h={14} w="70%" />
            </>
          ) : nearest.length ? (
            nearest.map((p) => (
              <div className="ix-peer" key={p.endpoint}>
                {p.id !== null ? (
                  <NodeLink nodeKey={p.endpoint} className="ix-mono">
                    {p.endpoint}
                  </NodeLink>
                ) : (
                  <span className="ix-mono">{p.endpoint}</span>
                )}
                <em className="ix-mono ix-dim">{p.latency_ms?.toFixed(0)} ms</em>
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
    </Block>
  );
}

// ---- related ----------------------------------------------------------------------------------------

/** How many of the newest blocks a node produced: the live ring first, an explicit look back after. */
function Produced() {
  const { id } = useNodeCtx();
  const ring = useChainBlocks();
  const summary = useSummary();
  const [extra, setExtra] = useState<{ blocks: number; heights: number[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const mine = ring.filter((b) => id !== null && b.producer === id);
  const perDay = summary && summary.node_count > 0 ? 2880 / summary.node_count : null;

  const lookBack = async () => {
    if (id === null || ring.length === 0 || busy) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    try {
      let before: number | null = ring[0]!.height;
      const heights: number[] = [];
      let blocks = 0;
      for (let page = 0; page < 4 && before !== null; page++) {
        const r = await api.blocks({ before, limit: 100 }, { signal: ctl.signal });
        blocks += r.items.length;
        for (const b of r.items) if (b.producer === id) heights.push(b.height);
        before = r.next_before;
      }
      setExtra({ blocks, heights });
    } catch {
      // Aborted or failed: leave the live count as it is.
    } finally {
      setBusy(false);
    }
  };

  const all = [...mine.map((b) => b.height), ...(extra?.heights ?? [])];
  const scanned = ring.length + (extra?.blocks ?? 0);
  return (
    <Block
      title="Blocks produced"
      icon={<Blocks size={14} strokeWidth={1.75} />}
      aside={
        <span className="ix-mono">
          {all.length} of the last {formatInt(scanned)}
        </span>
      }
      className="ix-produced"
    >
      {all.length ? (
        <div className="ix-chips">
          {all.map((h) => (
            <Chip key={h} mono>
              <BlockLink height={h}>#{formatInt(h)}</BlockLink>
            </Chip>
          ))}
        </div>
      ) : (
        <p className="ix-cap">
          None in the last {formatInt(scanned)} blocks (about {Math.round((scanned * 30) / 60)} min).
          {perDay
            ? ` Any node can produce a block; the average is about ${perDay.toFixed(2)} a day per node.`
            : ''}
        </p>
      )}
      <div className="ix-more">
        <Btn variant="ghost" onClick={lookBack} disabled={busy || extra !== null || id === null}>
          {busy ? 'Looking back' : extra ? 'Looked back 400 more' : 'Look back 400 blocks'}
        </Btn>
      </div>
    </Block>
  );
}

/** Hosted apps, co-hosted nodes, blocks produced and the node's recent events. */
export function ActivityBody() {
  const { detail, ip } = useNodeCtx();
  const store = useRuntime().store;
  const { clock } = useRuntime();
  const now = clock.now();
  const apps = detail?.apps ?? [];
  const co = detail?.co_hosted ?? [];
  const events = detail?.recent_events ?? [];

  return (
    <>
      <Block
        title="Apps"
        icon={<Boxes size={14} strokeWidth={1.75} />}
        aside={detail ? `${apps.length} running` : undefined}
      >
        {!detail ? (
          <Sk h={26} w="70%" />
        ) : apps.length ? (
          <div className="ix-chips">
            {apps.map((a) => (
              <AppLink
                key={a.name}
                name={a.name}
                className="ix-chip ix-appchip"
                title={`Open ${a.display_name}`}
              >
                <Boxes size={13} strokeWidth={1.75} aria-hidden="true" />
                {a.display_name}
              </AppLink>
            ))}
          </div>
        ) : (
          <p className="ix-cap">No apps run on this node.</p>
        )}
      </Block>

      <Block title="Co-hosted nodes" icon={<Hexagon size={14} strokeWidth={1.75} />} aside={ip ?? undefined}>
        {!detail ? (
          <Sk h={26} w="60%" />
        ) : co.length ? (
          <div className="ix-chips">
            {co.map((cid) => {
              const n = readNodeLive(store, cid);
              return (
                <NodeLink
                  key={cid}
                  nodeKey={n?.endpoint || cid}
                  className="ix-chip"
                  data-tier={n?.tier ?? 'unknown'}
                >
                  <TierGlyph tier={n?.tier ?? 'unknown'} size={12} />
                  {n?.endpoint ? `:${n.endpoint.split(':').pop()}` : `Node ${cid}`}
                </NodeLink>
              );
            })}
          </div>
        ) : (
          <p className="ix-cap">The only node on this IP.</p>
        )}
      </Block>

      <Produced />

      <Block
        title="Recent events"
        icon={<History size={14} strokeWidth={1.75} />}
        aside={detail ? `${events.length} recorded` : undefined}
      >
        {!detail ? (
          <Sk h={34} />
        ) : events.length ? (
          <ul className="ix-evlist">
            {events.slice(0, 8).map((e) => (
              <FeedLine key={`${e.kind}:${e.ts_ms}`} item={e} nowMs={now} />
            ))}
          </ul>
        ) : (
          <p className="ix-cap">No events recorded for this node yet. History starts at our first ingest.</p>
        )}
      </Block>
    </>
  );
}
