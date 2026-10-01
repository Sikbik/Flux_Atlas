import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../api/endpoints';
import { useChainBlocks, useRuntime, useSummary } from '../../../app/context';
import { formatInt } from '../../../lib/format';
import { Button, Chip, EntityLink, Height, Skeleton, TierGlyph, Timeline } from '../../../ui';
import { readNodeLive } from '../sources/live';
import { useNodeCtx } from './context';
import { feedTimeline } from './events';
import { SubHead } from './SubHead';

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
      // The ring is newest first: older blocks start below its last (oldest) entry.
      let before: number | null = ring[ring.length - 1]!.height;
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
    <div>
      <SubHead title="Blocks produced" note={`${all.length} of the last ${formatInt(scanned)}`} />
      {all.length ? (
        <div className="ix-chips">
          {all.map((h) => (
            <Chip key={h} mono>
              <Height value={h} />
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
        <Button variant="ghost" size="sm" onClick={lookBack} disabled={busy || extra !== null || id === null}>
          {busy ? 'Looking back' : extra ? 'Looked back 400 more' : 'Look back 400 blocks'}
        </Button>
      </div>
    </div>
  );
}

/** Hosted apps, co-hosted nodes, blocks produced and the node's recent events. */
export function ActivityBody() {
  const { detail, ip } = useNodeCtx();
  const { store } = useRuntime();
  const apps = detail?.apps ?? [];
  const co = detail?.co_hosted ?? [];
  const events = useMemo(() => feedTimeline(detail?.recent_events ?? []), [detail]);

  return (
    <div className="ix-stack ix-stack-lg">
      <div>
        <SubHead title="Apps" note={detail ? `${apps.length} running` : undefined} />
        {!detail ? (
          <Skeleton h={26} w="70%" />
        ) : apps.length ? (
          <div className="ix-links">
            {apps.map((a) => (
              <EntityLink key={a.name} kind="app" value={a.name} icon>
                {a.display_name}
              </EntityLink>
            ))}
          </div>
        ) : (
          <p className="ix-cap">No apps run on this node.</p>
        )}
      </div>

      <div>
        <SubHead title="Co-hosted nodes" note={ip ?? undefined} />
        {!detail ? (
          <Skeleton h={26} w="60%" />
        ) : co.length ? (
          <div className="ix-links">
            {co.map((cid) => {
              const n = readNodeLive(store, cid);
              const tier = n?.tier ?? 'unknown';
              return (
                <span className="ix-link-tier" key={cid}>
                  <TierGlyph tier={tier} size={12} />
                  <EntityLink kind="node" value={n?.endpoint || String(cid)}>
                    {n?.endpoint ? `:${n.endpoint.split(':').pop()}` : `Node ${cid}`}
                  </EntityLink>
                </span>
              );
            })}
          </div>
        ) : (
          <p className="ix-cap">The only node on this IP.</p>
        )}
      </div>

      <Produced />

      <div>
        <SubHead
          title="Recent events"
          note={detail ? `${detail.recent_events.length} recorded` : undefined}
        />
        {!detail ? (
          <Skeleton h={34} />
        ) : events.length ? (
          <Timeline items={events} label="Recent events of this node" />
        ) : (
          <p className="ix-cap">No events recorded for this node yet. History starts at our first ingest.</p>
        )}
      </div>
    </div>
  );
}
