// One tier's payment queue as a ring. Two canvases: the base layer (every slot as a tick, brighter
// toward the payout gate, white-hot just behind it, beads for nodes at risk) is drawn when the queue
// changes; the live layer (the block timer arc, the gate, the pulse when a block pays, the selection)
// is drawn every frame from the shared phase loop. Both are DPR aware and cost a few hundred strokes.

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useRuntime } from '../../../app/context';
import { formatInt } from '../../../lib/format';
import { cx as cn, tierLabel } from '../../../ui';
import type { QueueTier } from '../derive/queue';
import {
  angleOf,
  binCount,
  binOfPosition,
  onBand,
  slotAngle,
  slotAtAngle,
  TAU,
  tickShade,
} from '../derive/wheel';
import { readNodeLive } from '../sources/live';
import type { PhaseLoop } from '../sources/queueFeed';
import { fitCanvas, readVar, withAlpha } from '../ui/canvas';

/** Risk flags per queue position: 0 fine, 1 at risk (warn), 2 past expiry or offline (crit). */
export type RiskFlags = Uint8Array;

interface Palette {
  tier: string;
  hot: string;
  warn: string;
  crit: string;
  track: string;
}

/** The colours the rings are drawn in, read from the design tokens on the wheel's own element. */
function readPalette(el: Element, tier: QueueTier): Palette {
  return {
    tier: readVar(el, `--tier-${tier}`, 'white'),
    hot: readVar(el, '--hot', 'white'),
    warn: readVar(el, '--status-warn', 'white'),
    crit: readVar(el, '--status-crit', 'white'),
    track: readVar(el, '--line-2', 'transparent'),
  };
}

interface Geometry {
  s: number;
  cx: number;
  cy: number;
  /** Outer radius of the tick band. */
  ro: number;
  /** Inner radius of the tick band. */
  ri: number;
  /** Radius of the block timer arc. */
  rp: number;
}

function geometry(s: number): Geometry {
  const ro = s / 2 - 20;
  const len = Math.max(10, Math.min(18, s * 0.06));
  return { s, cx: s / 2, cy: s / 2, ro, ri: ro - len, rp: ro - len - 11 };
}

const QUANT = 10;

function drawBase(
  ctx: CanvasRenderingContext2D,
  g: Geometry,
  pal: Palette,
  n: number,
  risk: RiskFlags | null,
): void {
  const { s, cx, cy, ro, ri } = g;
  ctx.clearRect(0, 0, s, s);
  if (n <= 0) {
    ctx.strokeStyle = pal.track;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, (ro + ri) / 2, 0, TAU);
    ctx.stroke();
    return;
  }
  const bins = binCount(n, ro);
  const width = Math.max(1.1, (TAU * ro) / bins - 1.2);
  ctx.lineCap = 'butt';
  ctx.lineWidth = width;

  // Ticks, batched by quantised brightness so the ring costs a handful of strokes.
  const run: Path2D[] = Array.from({ length: QUANT + 1 }, () => new Path2D());
  const wake: Path2D[] = Array.from({ length: QUANT + 1 }, () => new Path2D());
  for (let b = 0; b < bins; b++) {
    const th = ((b + 0.5) / bins) * TAU - Math.PI / 2;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    const sh = tickShade(b, bins);
    const q = Math.round(Math.max(0, Math.min(1, sh.run)) * QUANT);
    run[q]!.moveTo(cx + c * ri, cy + sn * ri);
    run[q]!.lineTo(cx + c * ro, cy + sn * ro);
    if (sh.wake > 0.04) {
      const w = Math.round(Math.min(1, sh.wake) * QUANT);
      wake[w]!.moveTo(cx + c * (ri - 2), cy + sn * (ri - 2));
      wake[w]!.lineTo(cx + c * (ro + 2), cy + sn * (ro + 2));
    }
  }
  for (let q = 1; q <= QUANT; q++) {
    ctx.strokeStyle = withAlpha(pal.tier, (q / QUANT) * 0.92);
    ctx.stroke(run[q]!);
  }
  for (let q = 1; q <= QUANT; q++) {
    ctx.strokeStyle = withAlpha(pal.hot, (q / QUANT) * 0.95);
    ctx.stroke(wake[q]!);
  }

  // Beads for nodes at risk, outside the band, so risk reads as scatter around the ring.
  if (risk) {
    const seen = new Uint8Array(bins);
    for (let i = 0; i < n; i++) {
      const f = risk[i]!;
      if (f === 0) continue;
      const b = binOfPosition(i, n, bins);
      if (seen[b]! >= f) continue;
      seen[b] = f;
    }
    ctx.lineWidth = 1;
    for (let b = 0; b < bins; b++) {
      const f = seen[b]!;
      if (f === 0) continue;
      const th = ((b + 0.5) / bins) * TAU - Math.PI / 2;
      ctx.fillStyle = f >= 2 ? pal.crit : pal.warn;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(th) * (ro + 7), cy + Math.sin(th) * (ro + 7), f >= 2 ? 2.2 : 1.8, 0, TAU);
      ctx.fill();
    }
  }

  // A hairline circle outside the band as the ring's frame.
  ctx.strokeStyle = pal.track;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, ro + 13, 0, TAU);
  ctx.stroke();
}

interface LiveState {
  n: number;
  selected: number | null;
  hover: number | null;
  /** performance.now() of the last block this wheel saw, or 0. */
  blockAt: number;
  animated: boolean;
}

function drawLive(
  ctx: CanvasRenderingContext2D,
  g: Geometry,
  pal: Palette,
  st: LiveState,
  phase: number,
  nowPerf: number,
): void {
  const { s, cx, cy, ro, ri, rp } = g;
  ctx.clearRect(0, 0, s, s);
  const top = -Math.PI / 2;

  // The block timer: a thin arc that fills over one block, a glowing head at its end.
  ctx.lineCap = 'round';
  ctx.lineWidth = 2;
  ctx.strokeStyle = pal.track;
  ctx.beginPath();
  ctx.arc(cx, cy, rp, 0, TAU);
  ctx.stroke();
  if (phase > 0) {
    ctx.strokeStyle = withAlpha(pal.tier, 0.85);
    ctx.beginPath();
    ctx.arc(cx, cy, rp, top, top + phase * TAU);
    ctx.stroke();
    const hx = cx + Math.cos(top + phase * TAU) * rp;
    const hy = cy + Math.sin(top + phase * TAU) * rp;
    const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 9);
    glow.addColorStop(0, withAlpha(pal.tier, 0.9));
    glow.addColorStop(1, withAlpha(pal.tier, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(hx, hy, 9, 0, TAU);
    ctx.fill();
    ctx.fillStyle = pal.hot;
    ctx.beginPath();
    ctx.arc(hx, hy, 2.2, 0, TAU);
    ctx.fill();
  }

  // The gate: a bright radial mark at 12 o'clock, stronger as the block comes due.
  const due = Math.max(0, (phase - 0.82) / 0.18);
  ctx.lineCap = 'round';
  ctx.strokeStyle = withAlpha(pal.hot, 0.2 + 0.1 * due);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - rp + 5);
  ctx.lineTo(cx, cy - ro - 11);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(pal.hot, 0.8 + 0.2 * due);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx, cy - rp + 5);
  ctx.lineTo(cx, cy - ro - 11);
  ctx.stroke();

  // The pulse when a block pays this tier: one ring leaving the gate.
  if (st.animated && st.blockAt > 0) {
    const f = (nowPerf - st.blockAt) / 1100;
    if (f >= 0 && f < 1) {
      const ease = 1 - (1 - f) * (1 - f);
      ctx.strokeStyle = withAlpha(pal.hot, (1 - f) * 0.7);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, ro + 2 + ease * 22, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = withAlpha(pal.hot, (1 - f) * 0.9);
      ctx.beginPath();
      ctx.arc(cx, cy - (ri + ro) / 2, 3 + (1 - f) * 4, 0, TAU);
      ctx.fill();
    }
  }

  // The hovered and the selected node, as rings on the band.
  const mark = (pos: number, strong: boolean) => {
    if (st.n <= 0) return;
    const th = slotAngle(pos, st.n, phase) - Math.PI / 2;
    const r = (ri + ro) / 2;
    const x = cx + Math.cos(th) * r;
    const y = cy + Math.sin(th) * r;
    if (strong) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 16);
      glow.addColorStop(0, withAlpha(pal.tier, 0.75));
      glow.addColorStop(1, withAlpha(pal.tier, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = withAlpha(pal.hot, 0.9);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(th) * (ro + 2), cy + Math.sin(th) * (ro + 2));
      ctx.lineTo(cx + Math.cos(th) * (ro + 11), cy + Math.sin(th) * (ro + 11));
      ctx.stroke();
    }
    ctx.strokeStyle = strong ? pal.hot : withAlpha(pal.hot, 0.7);
    ctx.lineWidth = strong ? 1.6 : 1.2;
    ctx.beginPath();
    ctx.arc(x, y, strong ? 5 : 3.6, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = strong ? pal.hot : withAlpha(pal.hot, 0.85);
    ctx.beginPath();
    ctx.arc(x, y, strong ? 1.8 : 1.2, 0, TAU);
    ctx.fill();
  };
  if (st.hover !== null && st.hover !== st.selected) mark(st.hover, false);
  if (st.selected !== null) mark(st.selected, true);
}

export interface WheelProps {
  tier: QueueTier;
  /** Node ids in queue order, head first. */
  ids: Uint32Array;
  size: number;
  loop: PhaseLoop;
  /** Height of the tip block this queue is for: a change fires the pulse. */
  tip: number | null;
  risk: RiskFlags | null;
  /** Zero-based position of the selected node, when it is in this tier. */
  selected: number | null;
  onSelect: (nodeId: number) => void;
  /** Centre content (name, count, countdown); it ignores the pointer. */
  children?: ReactNode;
  className?: string;
  /** Eta label for a position, for the hover card. */
  etaFor: (position: number) => string;
}

export function Wheel({
  tier,
  ids,
  size,
  loop,
  tip,
  risk,
  selected,
  onSelect,
  children,
  className,
  etaFor,
}: WheelProps) {
  const { store } = useRuntime();
  const box = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const live = useRef<HTMLCanvasElement>(null);
  const [side, setSide] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const palette = useRef<Palette | null>(null);
  const paletteKey = useRef('');
  const state = useRef<LiveState>({ n: size, selected, hover: null, blockAt: 0, animated: loop.animated });
  const lastTip = useRef<number | null>(tip);

  state.current.n = size;
  state.current.selected = selected;
  state.current.hover = hover;
  state.current.animated = loop.animated;

  // Size follows the box (the window and its container queries decide it).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      setSide((prev) => (Math.abs(prev - w) >= 2 ? w : prev));
    });
    ro.observe(el);
    setSide(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  // A block that landed pulses the gate.
  useEffect(() => {
    if (lastTip.current !== null && tip !== null && tip > lastTip.current)
      state.current.blockAt = performance.now();
    lastTip.current = tip;
  }, [tip]);

  // Base layer: only when the queue, the risk flags or the size change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `ids` identity marks a new queue snapshot
  useEffect(() => {
    const cv = base.current;
    const el = box.current;
    if (!cv || !el || side <= 0) return;
    const ctx = fitCanvas(cv, side, side);
    if (!ctx) return;
    // The colours come from the design tokens: read once per tier and size, not at every block.
    if (!palette.current || paletteKey.current !== `${tier}:${side}`) {
      palette.current = readPalette(el, tier);
      paletteKey.current = `${tier}:${side}`;
    }
    drawBase(ctx, geometry(side), palette.current, size, risk);
  }, [ids, size, risk, side, tier]);

  // Live layer: every frame while the loop runs, once per change otherwise.
  useEffect(() => {
    const cv = live.current;
    const el = box.current;
    if (!cv || !el || side <= 0) return undefined;
    const ctx = fitCanvas(cv, side, side);
    if (!ctx) return undefined;
    const g = geometry(side);
    const pal = palette.current ?? readPalette(el, tier);
    return loop.subscribe((phase) => drawLive(ctx, g, pal, state.current, phase, performance.now()));
  }, [loop, side, tier]);

  // Reduced motion: redraw the live layer by hand when the selection or hover moves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the dependencies are the visible changes
  useEffect(() => {
    if (loop.animated) return;
    const cv = live.current;
    const el = box.current;
    if (!cv || !el || side <= 0) return;
    const ctx = fitCanvas(cv, side, side);
    if (ctx) drawLive(ctx, geometry(side), palette.current ?? readPalette(el, tier), state.current, 0, 0);
  }, [loop.animated, selected, hover, side, tier]);

  const pick = (ev: React.PointerEvent | React.MouseEvent): number | null => {
    const el = box.current;
    if (!el || side <= 0 || size <= 0) return null;
    const r = el.getBoundingClientRect();
    const g = geometry(side);
    const dx = ev.clientX - r.left - g.cx;
    const dy = ev.clientY - r.top - g.cy;
    if (!onBand(dx, dy, g.ri, g.ro, 7)) return null;
    return slotAtAngle(angleOf(dx, dy), size, loop.phase());
  };

  const hoverId = hover !== null ? (ids[hover] ?? null) : null;
  const hoverNode = hoverId !== null ? readNodeLive(store, hoverId) : null;
  const g = geometry(Math.max(side, 1));
  const tipAngle = hover !== null ? slotAngle(hover, size, loop.phase()) : 0;
  const tipX = g.cx + Math.sin(tipAngle) * ((g.ri + g.ro) / 2);
  const tipY = g.cy - Math.cos(tipAngle) * ((g.ri + g.ro) / 2);
  // The card opens inward near a side, so it never runs past the ring's box.
  const tipAlign = tipX < side * 0.3 ? 'start' : tipX > side * 0.7 ? 'end' : 'center';

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the ring is a pointer shortcut; search and the belt tiles select the same nodes from the keyboard
    <div
      ref={box}
      className={cn('ix-wheel', className)}
      data-tier={tier}
      data-hover={hover !== null || undefined}
      onPointerMove={(ev) => {
        const p = pick(ev);
        setHover((prev) => (prev === p ? prev : p));
      }}
      onPointerLeave={() => setHover(null)}
      onClick={(ev) => {
        const p = pick(ev);
        const id = p !== null ? ids[p] : undefined;
        if (id !== undefined) onSelect(id);
      }}
      role="img"
      aria-label={`${tierLabel(tier)} payment queue, ${formatInt(size)} nodes`}
    >
      <canvas ref={base} aria-hidden="true" tabIndex={-1} />
      <canvas ref={live} aria-hidden="true" tabIndex={-1} />
      <div className="ix-wheel-mid">{children}</div>
      {hover !== null && hoverNode ? (
        <div className="ix-wheel-tip" data-align={tipAlign} style={{ left: tipX, top: tipY }}>
          <b className="ix-mono">#{formatInt(hover + 1)}</b>
          <span className="ix-mono">{hoverNode.endpoint}</span>
          <small>{etaFor(hover)}</small>
        </div>
      ) : null}
    </div>
  );
}
