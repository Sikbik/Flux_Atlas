// A coarse land dot matrix for flat maps, rasterized once from the same Natural Earth TopoJSON the
// globe uses (`public/data/land-110m.json`). Everything is lazy: nothing loads until a map mounts.

interface Topology {
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: Record<string, { type: string; geometries?: Geom[]; arcs?: number[][] | number[][][] }>;
}
interface Geom {
  type: string;
  arcs?: number[][] | number[][][];
  geometries?: Geom[];
}

function decodeArcs(topo: Topology): Float32Array[] {
  const [sx, sy] = topo.transform?.scale ?? [1, 1];
  const [tx, ty] = topo.transform?.translate ?? [0, 0];
  return topo.arcs.map((arc) => {
    const out = new Float32Array(arc.length * 2);
    let x = 0;
    let y = 0;
    for (let i = 0; i < arc.length; i++) {
      x += arc[i]![0]!;
      y += arc[i]![1]!;
      out[i * 2] = x * sx + tx;
      out[i * 2 + 1] = y * sy + ty;
    }
    return out;
  });
}

function collectRings(g: Geom, out: number[][]): void {
  if (g.type === 'GeometryCollection') for (const c of g.geometries ?? []) collectRings(c, out);
  else if (g.type === 'Polygon') for (const ring of (g.arcs ?? []) as number[][]) out.push(ring);
  else if (g.type === 'MultiPolygon')
    for (const poly of (g.arcs ?? []) as number[][][]) for (const ring of poly) out.push(ring);
}

function ringPoints(ring: number[], arcs: Float32Array[]): number[] {
  const pts: number[] = [];
  for (const idx of ring) {
    const rev = idx < 0;
    const a = arcs[rev ? ~idx : idx]!;
    const n = a.length / 2;
    const start = pts.length === 0 ? 0 : 1;
    if (!rev) for (let i = start; i < n; i++) pts.push(a[i * 2]!, a[i * 2 + 1]!);
    else for (let i = n - 1 - start; i >= 0; i--) pts.push(a[i * 2]!, a[i * 2 + 1]!);
  }
  return pts;
}

/** The latitude band a flat map shows (no Antarctica, a little arctic headroom). */
export const MAP_LAT_MAX = 84;
export const MAP_LAT_MIN = -58;

export interface LandDots {
  /** Cell size in degrees. */
  cell: number;
  /** Dot centres as `[lon, lat]` pairs, flat. */
  lonLat: Float32Array;
}

let cache: Promise<LandDots> | null = null;

/** Rasterizes the land into cells of `cell` degrees and keeps the cells that are mostly land. */
export function loadLandDots(base = import.meta.env.BASE_URL, cell = 2): Promise<LandDots> {
  if (cache) return cache;
  cache = (async () => {
    const res = await fetch(`${base}data/land-110m.json`);
    if (!res.ok) throw new Error(`land mask: ${res.status}`);
    const topo = (await res.json()) as Topology;
    const arcs = decodeArcs(topo);
    const rings: number[][] = [];
    const land = topo.objects.land;
    if (land) collectRings(land as Geom, rings);
    const cols = Math.round(360 / cell);
    const rows = Math.round(180 / cell);
    const ss = 4; // supersampling per axis, for the coverage of each cell
    const W = cols * ss;
    const H = rows * ss;
    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(W, H)
        : Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (const ring of rings) {
      const p = ringPoints(ring, arcs);
      for (let i = 0; i < p.length; i += 2) {
        const x = ((p[i]! + 180) / 360) * W;
        const y = ((90 - p[i + 1]!) / 180) * H;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    ctx.fill('evenodd');
    const img = ctx.getImageData(0, 0, W, H).data;
    const out: number[] = [];
    for (let cy = 0; cy < rows; cy++) {
      const lat = 90 - (cy + 0.5) * cell;
      if (lat > MAP_LAT_MAX || lat < MAP_LAT_MIN) continue;
      for (let cx = 0; cx < cols; cx++) {
        let land = 0;
        for (let sy = 0; sy < ss; sy++)
          for (let sx = 0; sx < ss; sx++) if (img[((cy * ss + sy) * W + cx * ss + sx) * 4]! > 127) land++;
        if (land / (ss * ss) >= 0.38) out.push(-180 + (cx + 0.5) * cell, lat);
      }
    }
    return { cell, lonLat: Float32Array.from(out) };
  })();
  cache.catch(() => {
    cache = null;
  });
  return cache;
}
