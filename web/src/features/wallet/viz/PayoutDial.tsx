// The payout dial: the wallet's next payments laid out on a ring that reads from now (the top) clockwise to the
// horizon. One track per tier, a dot per node while a tier is small and a radial histogram once it is big, the
// next payment at the centre as a countdown. Nothing moves at rest; the marks glide when the horizon changes, and a
// payment that lands while the page is open sends a ring out from the hub. Plain SVG over the tokens, and a
// slider over the marks so the arrow keys read them in time order. `lib/payoutDial.ts` is the geometry.

import { Table2 } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRuntime } from '../../../app/context';
import { formatInt } from '../../../lib/format';
import { useFresh } from '../../../motion';
import { Button, cx, TierGlyph, tierLabel } from '../../../ui';
import { useBoundaryMs } from '../hooks/useBoundary';
import type { FleetRow } from '../lib/fleet';
import { type Landing, landingText } from '../lib/landing';
import {
  arcPath,
  barLength,
  buildDial,
  clockUtc,
  type DialHorizon,
  type DialItem,
  describeItem,
  dialSummary,
  dialTicks,
  HORIZON,
  polar,
  sectorPath,
  spokenSpan,
  toDialPayouts,
} from '../lib/payoutDial';
import type { PayTier, WalletPayout } from '../types';
import { Eta } from '../ui/Eta';
import './dial.css';

/** How often the dial's "now" moves: the marks drift under a pixel in this long, so redrawing sooner is waste. */
const STEP_MS = 15_000;
/** How close, in drawing units, the pointer must be to a mark to read it. */
const REACH = 16;
/** How long a landing's ring and the hub's "landed" reading last. */
const LAND_MS = 6_000;
/** Marks fade in at most this many steps apart, so a thousand-node wallet does not take a second to arrive. */
const STAGGER_CAP = 28;

export interface PayoutDialProps {
  /** The wallet's next payments (the server's list, soonest first). */
  payouts: readonly WalletPayout[];
  /** The wallet's nodes by outpoint, for a node's address in the readout. */
  nodes: ReadonlyMap<string, FleetRow>;
  landings: readonly Landing[];
  horizon: DialHorizon;
  /** The wallet's address: a new wallet starts the landings over. */
  scope: string;
  /** The pointer or keyboard rests on one node's mark (or leaves it, with null). */
  onNode: (row: FleetRow | null) => void;
  /** A node's mark is pressed. */
  onOpen: (key: string) => void;
}

interface Placed {
  item: DialItem;
  x: number;
  y: number;
}

const C = 220;

export function PayoutDial({ payouts, nodes, landings, horizon, scope, onNode, onOpen }: PayoutDialProps) {
  const nowMs = useBoundaryMs(STEP_MS);
  const { clock } = useRuntime();
  const dial = useMemo(() => buildDial(toDialPayouts(payouts), nowMs, horizon), [payouts, nowMs, horizon]);
  const g = dial.geometry;
  const ticks = useMemo(() => dialTicks(horizon), [horizon]);
  const stageRef = useRef<HTMLDivElement>(null);
  const tableId = useId();
  const [showTable, setShowTable] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const placed = useMemo<Placed[]>(
    () =>
      dial.items.map((item) => {
        const track = dial.tracks.find((t) => t.tier === item.tier);
        const r = track
          ? item.kind === 'dot'
            ? track.r
            : track.r + barLength(item.count, track) / 2
          : g.rim;
        const p = polar(C, C, r, item.angle);
        return { item, x: p.x, y: p.y };
      }),
    [dial, g.rim],
  );
  const activeIdx = activeId === null ? -1 : placed.findIndex((p) => p.item.id === activeId);
  const active = activeIdx >= 0 ? (placed[activeIdx] as Placed) : null;

  const landKeys = useMemo(() => landings.map((l) => String(l.height)), [landings]);
  const fresh = useFresh(landKeys, { ms: LAND_MS, max: 3, scope });
  const landed = landings.find((l) => fresh.has(String(l.height))) ?? null;

  /** The node a mark stands for: only a dot is one node (a bar is many). */
  const rowOf = useCallback(
    (item: DialItem | null): FleetRow | null =>
      item?.kind === 'dot' ? (nodes.get((item.nodes[0] as { key: string }).key) ?? null) : null,
    [nodes],
  );

  const select = useCallback(
    (id: string | null) => {
      setActiveId((cur) => (cur === id ? cur : id));
      const p = id === null ? null : (placed.find((x) => x.item.id === id) ?? null);
      onNode(rowOf(p?.item ?? null));
    },
    [placed, onNode, rowOf],
  );

  const nearest = (clientX: number, clientY: number): string | null => {
    const el = stageRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return null;
    const scale = g.size / r.width;
    const x = (clientX - r.left) * scale;
    const y = (clientY - r.top) * scale;
    let best: string | null = null;
    let bestD = REACH * REACH;
    for (const p of placed) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p.item.id;
      }
    }
    return best;
  };

  const onKey = (e: KeyboardEvent) => {
    const n = placed.length;
    if (n === 0) return;
    const at = activeIdx;
    let next: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = at < 0 ? 0 : Math.min(n - 1, at + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = at < 0 ? n - 1 : Math.max(0, at - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'PageDown') next = at < 0 ? 0 : Math.min(n - 1, at + 10);
    else if (e.key === 'PageUp') next = at < 0 ? n - 1 : Math.max(0, at - 10);
    else if (e.key === 'Enter' || e.key === ' ') {
      const row = rowOf(active?.item ?? null);
      if (row) {
        e.preventDefault();
        onOpen(row.key);
      }
      return;
    } else if (e.key === 'Escape') {
      if (active === null) return;
      e.stopPropagation();
      select(null);
      return;
    } else return;
    e.preventDefault();
    select((placed[next] as Placed).item.id);
  };

  const onPointer = (e: ReactPointerEvent) => {
    const id = nearest(e.clientX, e.clientY);
    select(id);
  };

  const summary = dialSummary(dial, clock.now());
  const tierCount = (t: PayTier) => dial.tracks.find((x) => x.tier === t)?.within ?? 0;
  const shownTip = active;

  return (
    <figure
      className="wl-dial"
      aria-label="Next payments of the wallet"
      data-empty={dial.total === 0 || undefined}
    >
      <p className="ui-sr-only">{summary}</p>
      <div className="wl-dial__stage" ref={stageRef}>
        <svg
          className="wl-dial__svg"
          viewBox={`0 0 ${g.size} ${g.size}`}
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <radialGradient id={`${tableId}-wash`} cx="50%" cy="50%" r="50%">
              <stop offset="0" className="wl-dial__wash-in" />
              <stop offset="1" className="wl-dial__wash-out" />
            </radialGradient>
          </defs>
          <circle className="wl-dial__wash" cx={C} cy={C} r={g.rim} fill={`url(#${tableId}-wash)`} />
          <circle className="wl-dial__rim" cx={C} cy={C} r={g.rim} />
          <circle className="wl-dial__hubring" cx={C} cy={C} r={g.hub} />

          <g className="wl-dial__ticks">
            {ticks.map((t) => {
              const a = polar(C, C, g.rim, t.angle);
              const b = polar(C, C, g.rim - (t.major ? 9 : 4), t.angle);
              return (
                <line
                  key={t.offsetMs}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  data-major={t.major || undefined}
                />
              );
            })}
            {ticks.map((t) => {
              if (!t.label) return null;
              const p = polar(C, C, g.rim + 15, t.angle);
              return (
                <text key={`l${t.offsetMs}`} x={p.x} y={p.y} textAnchor="middle" dy="0.35em">
                  {t.label}
                </text>
              );
            })}
          </g>

          <g className="wl-dial__tracks">
            {dial.tracks.map((t) => (
              <circle
                key={t.tier}
                className="wl-dial__track"
                data-tier={t.tier}
                data-mode={t.mode}
                cx={C}
                cy={C}
                r={t.r}
              />
            ))}
          </g>

          <g className="wl-dial__marks">
            {placed.map(({ item, x, y }, i) => {
              const track = dial.tracks.find((t) => t.tier === item.tier);
              const isNext = dial.next !== null && item.kind === 'dot' && item.nodes[0] === dial.next;
              const style = { '--i': Math.min(i, STAGGER_CAP) } as CSSProperties;
              if (item.kind === 'bin' && track) {
                const len = barLength(item.count, track);
                const pad = Math.min(0.004, (item.a1 - item.a0) * 0.12);
                return (
                  <path
                    key={item.id}
                    className="wl-dial__bar"
                    data-tier={item.tier}
                    data-active={item.id === activeId || undefined}
                    d={sectorPath(C, C, track.r + 1.5, track.r + 1.5 + len, item.a0 + pad, item.a1 - pad)}
                    style={style}
                  />
                );
              }
              return (
                <g
                  key={item.id}
                  className="wl-dial__dot"
                  data-tier={item.tier}
                  data-next={isNext || undefined}
                  data-active={item.id === activeId || undefined}
                  style={{ ...style, transform: `translate(${x}px, ${y}px)` }}
                >
                  <circle className="wl-dial__halo" r={10} />
                  <circle className="wl-dial__core" r={isNext ? 6 : 4.5} />
                </g>
              );
            })}
          </g>

          {dial.next && dial.next.etaMs - nowMs < HORIZON[horizon].ms ? (
            <g className="wl-dial__lead">
              {(() => {
                const a = (dial.next.etaMs - nowMs) / HORIZON[horizon].ms;
                const from = polar(C, C, g.hub + 1, a * Math.PI * 2);
                const t = dial.tracks.find((x) => x.tier === dial.next?.tier);
                const to = polar(C, C, (t?.r ?? g.rim) - 8, a * Math.PI * 2);
                return <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
              })()}
            </g>
          ) : null}

          <g className="wl-dial__now">
            <path d={`M${C} ${C - g.rim + 14}l-4.5 -9.5h9z`} />
            <text x={C} y={C - g.rim - 16} textAnchor="middle">
              now
            </text>
          </g>

          {landings
            .filter((l) => fresh.has(String(l.height)))
            .map((l) => (
              <circle key={l.height} className="wl-dial__ping" data-fresh cx={C} cy={C} r={g.hub} />
            ))}
          {dial.tracks.length > 0 ? (
            <path className="wl-dial__sweep" pathLength={1} d={arcPath(C, C, g.rim, 0, Math.PI * 2)} />
          ) : null}
        </svg>

        <div
          className="wl-dial__hub"
          data-fresh={landed ? true : undefined}
          data-state={landed ? 'landed' : active ? 'item' : dial.next ? 'next' : 'empty'}
        >
          {landed ? (
            <>
              <span className="wl-dial__label">Payment landed</span>
              <b className="wl-dial__big ui-mono">+{landed.flux.toFixed(2)}</b>
              <span className="wl-dial__sub">FLUX, block {formatInt(landed.height)}</span>
              <span className="wl-dial__line">{landingText(landed)}</span>
            </>
          ) : active ? (
            <ItemReadout item={active.item} nowMs={nowMs} nodes={nodes} />
          ) : dial.next ? (
            <>
              <span className="wl-dial__label">Next payment</span>
              <b className="wl-dial__big ui-mono">
                <Eta at={dial.next.etaMs} />
              </b>
              <span className="wl-dial__sub">+{dial.next.amount.toFixed(2)} FLUX</span>
              <span className="wl-dial__line ui-mono">{nodes.get(dial.next.key)?.endpoint || ' '}</span>
            </>
          ) : (
            <>
              <span className="wl-dial__label">Next payment</span>
              <b className="wl-dial__big wl-dial__big--quiet">{dial.total === 0 ? 'None queued' : 'Soon'}</b>
              <span className="wl-dial__sub">
                {dial.total === 0 ? 'No node is in a queue' : 'Nothing inside this horizon'}
              </span>
            </>
          )}
        </div>

        <div
          className="wl-dial__focus"
          role="slider"
          tabIndex={0}
          aria-label="Payout dial. Use the arrow keys to read each payment in time order."
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, placed.length - 1)}
          aria-valuenow={Math.max(0, activeIdx)}
          aria-valuetext={active ? describeItem(active.item) : summary}
          onPointerMove={(e) => {
            if (e.pointerType !== 'touch') onPointer(e);
          }}
          onPointerDown={onPointer}
          onPointerLeave={(e) => {
            if (e.pointerType !== 'touch') select(null);
          }}
          onKeyDown={onKey}
          onBlur={() => select(null)}
          onClick={() => {
            const row = rowOf(active?.item ?? null);
            if (row) onOpen(row.key);
          }}
          data-hit={rowOf(active?.item ?? null) ? '' : undefined}
        />

        {shownTip ? (
          <div
            className="wl-dial__tip"
            role="presentation"
            data-side={shownTip.x > g.size / 2 ? 'left' : 'right'}
            data-v={shownTip.y > g.size / 2 ? 'up' : 'down'}
            style={{ left: `${(shownTip.x / g.size) * 100}%`, top: `${(shownTip.y / g.size) * 100}%` }}
          >
            <TipBody item={shownTip.item} nowMs={nowMs} nodes={nodes} />
          </div>
        ) : null}
      </div>

      <figcaption className="wl-dial__foot">
        <ul className="wl-dial__legend" aria-label="Payments by tier inside the horizon">
          {dial.tracks
            .slice()
            .reverse()
            .map((t) => (
              <li key={t.tier} data-tier={t.tier}>
                <TierGlyph tier={t.tier} size={14} />
                <span>{tierLabel(t.tier)}</span>
                <b className="ui-mono">{formatInt(tierCount(t.tier))}</b>
                <i>due</i>
              </li>
            ))}
        </ul>
        <Button
          size="sm"
          variant="ghost"
          icon={Table2}
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? 'Hide data' : 'Show data'}
        </Button>
      </figcaption>

      {showTable ? (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard so its rows can be scrolled
        <section id={tableId} className="vz-table-wrap" aria-label="Payout dial, data" tabIndex={0}>
          <table className="vz-table">
            <caption>{summary}</caption>
            <thead>
              <tr>
                <th scope="col">When (UTC)</th>
                <th scope="col">In</th>
                <th scope="col">Tier</th>
                <th scope="col">Payments</th>
                <th scope="col">FLUX</th>
              </tr>
            </thead>
            <tbody>
              {dial.items.map((it) => (
                <tr key={it.id}>
                  <th scope="row">{clockUtc(nowMs + it.from)}</th>
                  <td>{spokenSpan(it.from)}</td>
                  <td className={cx('wl-dial__cell-tier')}>{tierLabel(it.tier)}</td>
                  <td>
                    {it.kind === 'dot'
                      ? (nodes.get((it.nodes[0] as { key: string }).key)?.endpoint ?? '1 node')
                      : formatInt(it.count)}
                  </td>
                  <td>{it.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </figure>
  );
}

/** What a mark is, in the hub while the pointer rests on it. */
function ItemReadout({
  item,
  nowMs,
  nodes,
}: {
  item: DialItem;
  nowMs: number;
  nodes: ReadonlyMap<string, FleetRow>;
}) {
  if (item.kind === 'dot') {
    const n = item.nodes[0] as { key: string; etaMs: number; amount: number };
    return (
      <>
        <span className="wl-dial__label">{tierLabel(item.tier)} node</span>
        <b className="wl-dial__big ui-mono">
          <Eta at={n.etaMs} />
        </b>
        <span className="wl-dial__sub">+{n.amount.toFixed(2)} FLUX</span>
        <span className="wl-dial__line ui-mono">{nodes.get(n.key)?.endpoint || ' '}</span>
      </>
    );
  }
  return (
    <>
      <span className="wl-dial__label">{tierLabel(item.tier)} payments</span>
      <b className="wl-dial__big ui-mono">{formatInt(item.count)}</b>
      <span className="wl-dial__sub">{item.amount.toFixed(2)} FLUX</span>
      <span className="wl-dial__line ui-mono">
        {clockUtc(nowMs + item.from)} to {clockUtc(nowMs + item.to)}
      </span>
    </>
  );
}

function TipBody({
  item,
  nowMs,
  nodes,
}: {
  item: DialItem;
  nowMs: number;
  nodes: ReadonlyMap<string, FleetRow>;
}) {
  const when = clockUtc(nowMs + item.from);
  if (item.kind === 'dot') {
    const n = item.nodes[0] as { key: string; amount: number };
    const row = nodes.get(n.key);
    return (
      <>
        <div className="wl-dial__tip-head">
          <span>{when} UTC</span>
          <span>in {spokenSpan(item.from)}</span>
        </div>
        <div className="wl-dial__tip-row">
          <TierGlyph tier={item.tier} size={14} />
          <span className="wl-dial__tip-name ui-mono">{row?.endpoint || 'Node'}</span>
          <strong className="ui-mono">+{n.amount.toFixed(2)}</strong>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="wl-dial__tip-head">
        <span>
          {when} to {clockUtc(nowMs + item.to)} UTC
        </span>
      </div>
      <div className="wl-dial__tip-row">
        <TierGlyph tier={item.tier} size={14} />
        <span className="wl-dial__tip-name">
          {formatInt(item.count)} {item.count === 1 ? 'payment' : 'payments'}
        </span>
        <strong className="ui-mono">{item.amount.toFixed(2)}</strong>
      </div>
    </>
  );
}
