// The mini map: a dot-matrix piece of the planet fitted to a handful of points (a node's place, a
// host, an app's constellation, an operator's fleet). Canvas, DPR-aware, redrawn only when its points
// or size change; new points arrive with a ring that expands once (skipped under reduced motion).

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { effectiveMotion, useUi } from '../../../store/ui';
import { cx } from '../../../ui';
import { readVar, withAlpha } from './canvas';
import { isLand, type LandMask, loadLand } from './land';
import './map.css';

export interface MapPoint {
  id: string | number;
  lat: number;
  lon: number;
  /** Tints the marker ring and glow. */
  tier?: string;
  label?: string;
  /** A white ring around the marker (the subject, a watched node). */
  ring?: boolean;
  tone?: 'ok' | 'warn' | 'crit' | 'off';
  /** Marker radius multiplier (default 1). */
  size?: number;
}

interface View {
  lat0: number;
  lon0: number;
  /** Pixels per degree of latitude. */
  ppd: number;
  cos0: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Fits the points with padding; a lone point gets a regional window, scattered points the world. */
export function fitView(
  points: readonly { lat: number; lon: number }[],
  w: number,
  h: number,
  opts: { minSpan?: number; world?: boolean } = {},
): View {
  const minSpan = opts.minSpan ?? 16;
  const ok = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const worldView = (): View => {
    const cos0 = Math.cos(rad(18));
    return { lat0: 18, lon0: 8, cos0, ppd: Math.min(h / 150, w / (360 * cos0)) };
  };
  if (opts.world || ok.length === 0) return worldView();
  // Longitudes relative to the first point, so a set that straddles the antimeridian stays tight.
  const ref = ok[0]!.lon;
  const rel = (lon: number) => {
    let d = lon - ref;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  };
  let minLat = 90;
  let maxLat = -90;
  let minLon = 1e9;
  let maxLon = -1e9;
  for (const p of ok) {
    const lo = rel(p.lon);
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, lo);
    maxLon = Math.max(maxLon, lo);
  }
  if (maxLon - minLon > 200) return worldView();
  const lat0 = (minLat + maxLat) / 2;
  const cos0 = Math.max(0.2, Math.cos(rad(lat0)));
  const pad = 1.35;
  const latSpan = Math.max(minSpan, (maxLat - minLat) * pad);
  const lonSpan = Math.max(minSpan * (w / h), (maxLon - minLon) * pad);
  const ppd = Math.min(h / latSpan, w / (lonSpan * cos0));
  let lon0 = ref + (minLon + maxLon) / 2;
  while (lon0 > 180) lon0 -= 360;
  while (lon0 < -180) lon0 += 360;
  return { lat0, lon0, ppd, cos0 };
}

function project(v: View, w: number, h: number, lat: number, lon: number): [number, number] {
  let d = lon - v.lon0;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return [w / 2 + d * v.ppd * v.cos0, h / 2 - (lat - v.lat0) * v.ppd];
}

interface Palette {
  tier: Record<string, string>;
  tone: Record<string, string>;
  land: string;
  landLit: string;
  line: string;
  text: string;
  halo: string;
  hot: string;
}

function readPalette(el: Element): Palette {
  const v = (name: string) => readVar(el, name);
  return {
    tier: {
      cumulus: v('--tier-cumulus'),
      nimbus: v('--tier-nimbus'),
      stratus: v('--tier-stratus'),
      unknown: v('--text-3'),
    },
    tone: {
      ok: v('--status-ok'),
      warn: v('--status-warn'),
      crit: v('--status-crit'),
      off: v('--status-off'),
    },
    land: withAlpha(v('--accent-400'), 0.3),
    landLit: withAlpha(v('--accent-300'), 0.92),
    line: v('--line-2'),
    text: v('--text-2'),
    halo: withAlpha(v('--ink-0'), 0.9),
    hot: v('--hot'),
  };
}

function markerColor(p: MapPoint, pal: Palette): string {
  if (p.tone) return pal.tone[p.tone] ?? pal.hot;
  return pal.tier[p.tier ?? 'unknown'] ?? pal.hot;
}

interface DrawArgs {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  mask: LandMask | null;
  view: View;
  points: readonly MapPoint[];
  links: ReadonlyArray<readonly [number, number]>;
  pal: Palette;
  /** Expanding-ring progress (0..1) per point id that is new; absent = settled. */
  fresh: ReadonlyMap<string | number, number>;
  labels: boolean;
}

function draw(a: DrawArgs): void {
  const { ctx, w, h, mask, view, points, links, pal, fresh } = a;
  ctx.clearRect(0, 0, w, h);
  const xy = points.map((p) => project(view, w, h, p.lat, p.lon));

  // Land as a dot matrix on a staggered grid, brighter near the subject so the eye lands on it.
  if (mask) {
    const step = Math.max(3.6, Math.min(6, view.ppd * 1.6));
    const rowH = step * 0.866;
    const spots = xy.length > 0 && xy.length <= 24 ? xy : null;
    const reach = Math.max(54, Math.min(w, h) * 0.62);
    const reach2 = reach * reach;
    const dim = new Path2D();
    const mid = new Path2D();
    const lit = new Path2D();
    for (let r = 0, y = rowH / 2; y < h; r++, y += rowH) {
      const off = r % 2 ? step / 2 : 0;
      for (let x = off + step / 2; x < w; x += step) {
        const lon = view.lon0 + (x - w / 2) / (view.ppd * view.cos0);
        const lat = view.lat0 - (y - h / 2) / view.ppd;
        if (!isLand(mask, lon, lat)) continue;
        let k = 0;
        if (spots) {
          let best = reach2;
          for (const s of spots) {
            const d2 = (s[0] - x) * (s[0] - x) + (s[1] - y) * (s[1] - y);
            if (d2 < best) best = d2;
          }
          k = 1 - best / reach2;
        }
        const path = k > 0.62 ? lit : k > 0.25 ? mid : dim;
        const rad2 = k > 0.62 ? 1.45 : k > 0.25 ? 1.2 : 1.05;
        path.moveTo(x + rad2, y);
        path.arc(x, y, rad2, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = pal.land;
    ctx.fill(dim);
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = pal.landLit;
    ctx.fill(mid);
    ctx.globalAlpha = 1;
    ctx.fill(lit);
  }

  // Routes between points: dashed, hairline white.
  if (links.length) {
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(pal.hot, 0.5);
    ctx.beginPath();
    for (const [i, j] of links) {
      const p = xy[i];
      const q = xy[j];
      if (!p || !q) continue;
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Markers: glow, ring in the tier or tone colour, a white core.
  const placed: Array<[number, number, number, number]> = [];
  points.forEach((p, i) => {
    const [x, y] = xy[i]!;
    if (x < -12 || y < -12 || x > w + 12 || y > h + 12) return;
    const s = p.size ?? 1;
    const col = markerColor(p, pal);
    const g = ctx.createRadialGradient(x, y, 0, x, y, 13 * s);
    g.addColorStop(0, withAlpha(col, 0.5));
    g.addColorStop(1, withAlpha(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 13 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, 5.2 * s, 0, Math.PI * 2);
    ctx.stroke();
    if (p.ring) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = pal.hot;
      ctx.beginPath();
      ctx.arc(x, y, 8 * s, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = pal.hot;
    ctx.beginPath();
    ctx.arc(x, y, 2.4 * s, 0, Math.PI * 2);
    ctx.fill();
    const f = fresh.get(p.id);
    if (f !== undefined && f < 1) {
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = col;
      ctx.globalAlpha = 1 - f;
      ctx.beginPath();
      ctx.arc(x, y, (6 + f * 18) * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  });

  // Labels last, skipping any that would overlap one already placed.
  if (a.labels) {
    ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    points.forEach((p, i) => {
      if (!p.label) return;
      const [x, y] = xy[i]!;
      if (x < 0 || y < 0 || x > w || y > h) return;
      const tw = ctx.measureText(p.label).width;
      const right = x + 11 + tw < w - 4;
      const lx = right ? x + 11 : x - 11 - tw;
      const box: [number, number, number, number] = [lx - 2, y - 7, lx + tw + 2, y + 7];
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
      placed.push(box);
      ctx.lineWidth = 3;
      ctx.strokeStyle = pal.halo;
      ctx.strokeText(p.label, lx, y);
      ctx.fillStyle = pal.text;
      ctx.fillText(p.label, lx, y);
    });
  }
}

export function MiniMap({
  points,
  links,
  height = 132,
  minSpan,
  world,
  label,
  legend,
  className,
  labels = true,
}: {
  points: readonly MapPoint[];
  /** Index pairs into `points`, or `chain` to connect them in order. */
  links?: ReadonlyArray<readonly [number, number]> | 'chain';
  height?: number;
  minSpan?: number;
  world?: boolean;
  label: string;
  legend?: ReactNode;
  className?: string;
  labels?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [mask, setMask] = useState<LandMask | null>(null);
  const seen = useRef<Map<string | number, number>>(new Map());
  const [tick, setTick] = useState(0);
  const motion = useUi((s) => s.motion);

  useEffect(() => {
    let live = true;
    loadLand().then(
      (m) => live && setMask(m),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      setWidth((prev) => (Math.abs(prev - w) >= 1 ? w : prev));
    });
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  const linkPairs = useMemo<ReadonlyArray<readonly [number, number]>>(() => {
    if (links === 'chain') return points.slice(1).map((_, i) => [i, i + 1] as const);
    return links ?? [];
  }, [links, points]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` drives the arrival animation frames
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || width <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const now = performance.now();
    const animate = effectiveMotion(motion) === 'full';
    const fresh = new Map<string | number, number>();
    let pending = false;
    for (const p of points) {
      if (!seen.current.has(p.id)) seen.current.set(p.id, animate && seen.current.size > 0 ? now : -1e9);
      const f = (now - seen.current.get(p.id)!) / 760;
      if (f < 1) {
        fresh.set(p.id, f);
        pending = true;
      }
    }
    draw({
      ctx,
      w: width,
      h: height,
      mask,
      view: fitView(points, width, height, { minSpan, world }),
      points,
      links: linkPairs,
      pal: readPalette(cv),
      fresh,
      labels,
    });
    if (!pending) return undefined;
    const id = requestAnimationFrame(() => setTick((t) => t + 1));
    return () => cancelAnimationFrame(id);
  }, [points, linkPairs, width, height, mask, minSpan, world, labels, motion, tick]);

  return (
    <div ref={box} className={cx('ix-map', className)} style={{ height }} role="img" aria-label={label}>
      <canvas ref={canvas} aria-hidden="true" tabIndex={-1} />
      {legend ? <div className="ix-map-legend">{legend}</div> : null}
    </div>
  );
}
