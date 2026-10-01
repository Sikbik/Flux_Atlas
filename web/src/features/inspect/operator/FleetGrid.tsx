// A fleet at a glance: one small square per node, coloured by how the node is doing, in payout order
// (top left is paid soonest). A canvas, so four hundred nodes cost one draw; hover names a node and a
// click opens it. The list under it is the keyboard and screen reader path to the same nodes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatInt } from '../../../lib/format';
import { type FleetNode, type FleetState, fleetState } from '../derive/operator';
import { fitCanvas, readVar, withAlpha } from '../ui/canvas';

export const STATE_WORDS: Record<FleetState, string> = {
  ok: 'Healthy',
  risk: 'Needs attention',
  down: 'Down',
  pending: 'Not confirmed',
  gone: 'Gone',
};

const FALLBACK: Record<FleetState, string> = {
  ok: '#3fdc95',
  risk: '#ff9a3d',
  down: '#ff5470',
  pending: '#86a1da',
  gone: '#717171',
};

const VAR: Record<FleetState, string> = {
  ok: '--status-ok',
  risk: '--status-warn',
  down: '--status-crit',
  pending: '--status-pending',
  gone: '--status-off',
};

interface Layout {
  pitch: number;
  gap: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
}

/** The cell size and columns for `n` nodes in `width` px: big cells for a handful, small for hundreds. */
export function gridLayout(n: number, width: number): Layout {
  if (n <= 0 || width <= 0) return { pitch: 12, gap: 2, cols: 1, rows: 0, width, height: 0 };
  const target = 64;
  const pitch = Math.max(8, Math.min(22, Math.floor(Math.sqrt((width * target) / n))));
  const gap = pitch >= 14 ? 3 : 2;
  const cols = Math.max(1, Math.floor((width + gap) / pitch));
  const rows = Math.ceil(n / cols);
  return { pitch, gap, cols, rows, width, height: rows * pitch - gap };
}

export function FleetGrid({
  nodes,
  onOpen,
}: {
  nodes: readonly FleetNode[];
  onOpen: (n: FleetNode) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  const states = useMemo(() => nodes.map(fleetState), [nodes]);
  const layout = useMemo(() => gridLayout(nodes.length, width), [nodes.length, width]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = cv.current;
    if (!canvas || layout.rows === 0) return;
    const ctx = fitCanvas(canvas, layout.width, layout.height);
    if (!ctx) return;
    ctx.clearRect(0, 0, layout.width, layout.height);
    const { pitch, gap, cols } = layout;
    const size = pitch - gap;
    const pal = {} as Record<FleetState, string>;
    for (const k of Object.keys(VAR) as FleetState[]) pal[k] = readVar(canvas, VAR[k], FALLBACK[k]);
    const radius = size >= 12 ? 4 : 2;
    for (let i = 0; i < states.length; i++) {
      const s = states[i] as FleetState;
      const x = (i % cols) * pitch;
      const y = Math.floor(i / cols) * pitch;
      // Healthy nodes sit back so the ones that need a look stand out.
      ctx.fillStyle = withAlpha(pal[s], s === 'ok' ? 0.5 : 0.95);
      ctx.beginPath();
      ctx.roundRect(x, y, size, size, radius);
      ctx.fill();
    }
    if (hover) {
      const x = (hover.i % cols) * pitch;
      const y = Math.floor(hover.i / cols) * pitch;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x - 1, y - 1, size + 2, size + 2, radius + 1);
      ctx.stroke();
    }
  }, [layout, states, hover]);

  const indexAt = useCallback(
    (clientX: number, clientY: number): { i: number; x: number; y: number } | null => {
      const el = cv.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = clientX - r.left;
      const y = clientY - r.top;
      const { pitch, gap, cols } = layout;
      const col = Math.floor(x / pitch);
      const row = Math.floor(y / pitch);
      if (col < 0 || col >= cols || row < 0) return null;
      // Between two cells: nothing.
      if (x - col * pitch > pitch - gap || y - row * pitch > pitch - gap) return null;
      const i = row * cols + col;
      return i < nodes.length ? { i, x: col * pitch + (pitch - gap) / 2, y: row * pitch } : null;
    },
    [layout, nodes.length],
  );

  const counts = useMemo(() => {
    const c: Record<FleetState, number> = { ok: 0, risk: 0, down: 0, pending: 0, gone: 0 };
    for (const s of states) c[s]++;
    return c;
  }, [states]);
  const summary = (Object.keys(counts) as FleetState[])
    .filter((k) => counts[k] > 0)
    .map((k) => `${formatInt(counts[k])} ${STATE_WORDS[k].toLowerCase()}`)
    .join(', ');

  const node = hover ? nodes[hover.i] : undefined;
  const flipped = hover ? hover.x > layout.width * 0.62 : false;
  return (
    <div ref={wrap} className="ix-fgrid">
      <canvas
        ref={cv}
        role="img"
        aria-label={`Status of ${formatInt(nodes.length)} nodes: ${summary}`}
        style={{ width: layout.width, height: layout.height }}
        data-hover={hover ? '' : undefined}
        onPointerMove={(e) => {
          const next = indexAt(e.clientX, e.clientY);
          setHover((cur) => (cur?.i === next?.i ? cur : next));
        }}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const hit = indexAt(e.clientX, e.clientY);
          const n = hit ? nodes[hit.i] : undefined;
          if (n) onOpen(n);
        }}
      />
      {hover && node ? (
        <div
          className="ix-fgrid-tip"
          data-flip={flipped || undefined}
          style={{ left: hover.x, top: hover.y }}
          role="presentation"
        >
          <b className="ui-mono">{node.endpoint || `Node ${node.id}`}</b>
          <span>
            {STATE_WORDS[states[hover.i] as FleetState]}
            {node.position !== null ? ` · #${formatInt(node.position + 1)} in line` : ''}
          </span>
        </div>
      ) : null}
    </div>
  );
}
