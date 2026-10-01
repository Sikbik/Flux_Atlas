// One tier's payee belt: the node paid by the last block at the payout gate, then the next payees
// approaching it, one slot per block. The belt moves continuously (a transform, set every frame from the
// shared phase loop) and each block moves the queue up by one, so the new head arrives at the gate as the
// old head is paid. The paid node leaves toward the back of the queue as a small token.

import { Check, Coins } from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useRuntime } from '../../../app/context';
import { BLOCK_MS, formatInt, middleTruncate, parseEndpoint } from '../../../lib/format';
import type { QueueTier } from '../derive/queue';
import { readNodeLive } from '../sources/live';
import type { Payee, PhaseLoop } from '../sources/queueFeed';
import { etaShort, tierLabel } from '../ui';

interface TileModel {
  i: number;
  id: number | null;
  label: string;
  port: string;
  state: 'paid' | 'next' | 'queued';
}

export interface LaneProps {
  tier: QueueTier;
  /** Node ids in queue order, head first. */
  ids: Uint32Array;
  size: number;
  tip: number | null;
  /** Newest payees of the tier, newest first. */
  paid: readonly Payee[];
  loop: PhaseLoop;
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** Upcoming tiles to draw. */
  ahead?: number;
  /** Server time of the latest 1 Hz tick, for the countdown on each tile. */
  nowMs: number;
}

const PAID_TILES = 2;

export function Lane({
  tier,
  ids,
  size,
  tip,
  paid,
  loop,
  selectedId,
  onSelect,
  ahead = 7,
  nowMs,
}: LaneProps) {
  const { store } = useRuntime();
  const view = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLOListElement>(null);
  const [width, setWidth] = useState(0);
  const [ghost, setGhost] = useState<{ key: number } | null>(null);
  const lastTip = useRef<number | null>(tip);
  const pitch = useRef(0);

  useEffect(() => {
    const el = view.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => {
      const w = Math.round(e[0]?.contentRect.width ?? 0);
      setWidth((p) => (Math.abs(p - w) >= 2 ? w : p));
    });
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  // Geometry: the slot pitch follows the lane width; the gate sits a little in from the left.
  const S = Math.max(104, Math.min(142, width / 5.6));
  const G = Math.max(64, Math.min(150, S * 1.05));
  pitch.current = S;

  // The belt itself is moved straight on the DOM node every frame, never through React.
  useEffect(() => {
    return loop.subscribe((phase) => {
      const el = track.current;
      if (el) el.style.transform = `translate3d(${(-phase * pitch.current).toFixed(2)}px,0,0)`;
    });
  }, [loop]);

  // A block that landed sends the paid node on its way to the back.
  useEffect(() => {
    if (lastTip.current !== null && tip !== null && tip > lastTip.current && loop.animated)
      setGhost({ key: tip });
    lastTip.current = tip;
  }, [tip, loop.animated]);

  const since = loop.anchorMs !== null ? Math.max(0, nowMs - loop.anchorMs) : 0;
  const tiles: TileModel[] = [];
  const describe = (id: number | null, address: string | null) => {
    const n = id !== null ? readNodeLive(store, id) : null;
    const ep = n?.endpoint ? parseEndpoint(n.endpoint) : null;
    if (ep) return { label: ep.host, port: ep.port ? `:${ep.port}` : '' };
    return {
      label: address ? middleTruncate(address, 5, 4) : id !== null ? `Node ${id}` : 'Unknown',
      port: '',
    };
  };
  for (let k = Math.min(PAID_TILES, paid.length) - 1; k >= 0; k--) {
    const p = paid[k]!;
    tiles.push({ i: -1 - k, id: p.node, ...describe(p.node, p.address), state: 'paid' });
  }
  for (let i = 0; i < Math.min(ahead, ids.length); i++) {
    const id = ids[i]!;
    tiles.push({ i, id, ...describe(id, null), state: i === 0 ? 'next' : 'queued' });
  }

  const lane: CSSProperties = { '--ix-S': `${S}px`, '--ix-G': `${G}px` } as CSSProperties;
  const tileLabel = (t: TileModel): string => {
    if (t.state === 'paid')
      return t.i === -1 ? 'just paid' : `${-1 - t.i} ${-1 - t.i === 1 ? 'block' : 'blocks'} ago`;
    return t.i === 0
      ? `in ${etaShort(Math.max(0, BLOCK_MS - since))}`
      : etaShort(Math.max(0, (t.i + 1) * BLOCK_MS - since));
  };

  return (
    <div className="ix-lane" data-tier={tier} style={lane}>
      <div className="ix-lane-view" ref={view}>
        <div className="ix-lane-gate" aria-hidden="true" />
        <div className="ix-lane-clip">
          <ol
            className="ix-lane-track"
            ref={track}
            aria-label={`Payees of ${tierLabel(tier)}: the last paid, then the next in line`}
          >
            {tiles.map((t) => {
              const body = (
                <>
                  <b className="ix-mono ix-btile-ep">{t.label}</b>
                  <span className="ix-btile-eta ix-mono">
                    {t.state === 'paid' ? <Check size={11} strokeWidth={2.2} aria-hidden="true" /> : null}
                    {t.state !== 'paid' && t.port ? <i>{t.port}</i> : null}
                    {tileLabel(t)}
                  </span>
                </>
              );
              const sel = t.id !== null && t.id === selectedId;
              const style = { '--ix-i': t.i } as CSSProperties;
              return (
                <li
                  className="ix-btile-cell"
                  key={t.i < 0 ? `p${t.id ?? t.i}` : `n${t.id ?? t.i}`}
                  style={style}
                >
                  {t.id !== null ? (
                    <button
                      type="button"
                      className="ix-btile"
                      data-state={t.state}
                      data-selected={sel || undefined}
                      onClick={() => onSelect(t.id as number)}
                      title={`Select ${t.label}${t.port}`}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="ix-btile" data-state={t.state}>
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
        {ghost ? (
          <span
            className="ix-ghost"
            key={ghost.key}
            style={{ '--ix-fly': `${Math.max(120, width - G - 48)}px` } as CSSProperties}
            onAnimationEnd={() => setGhost(null)}
            aria-hidden="true"
          >
            <Coins size={13} strokeWidth={2} />
          </span>
        ) : null}
        <div className="ix-lane-end" aria-hidden="true">
          <span>Back of the queue</span>
          <b className="ix-mono">#{formatInt(size)}</b>
        </div>
      </div>
    </div>
  );
}
