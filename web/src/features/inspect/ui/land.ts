// A land mask for the mini maps, rasterised once from the globe's own coastline data
// (`public/data/land-110m.json`, TopoJSON). The mini maps draw it as the same dot matrix the globe
// uses for land, so a constellation or a host's place reads as a piece of the planet.

interface Topo {
  arcs: number[][][];
  transform?: { scale: [number, number]; translate: [number, number] };
  objects: Record<string, TopoObject>;
}

interface TopoObject {
  type: string;
  arcs?: unknown;
  geometries?: TopoObject[];
}

export interface LandMask {
  w: number;
  h: number;
  data: Uint8Array;
}

const W = 720;
const H = 360;

/** Delta-encoded, quantised arcs to lon/lat pairs (`[lon, lat, lon, lat, ...]`). */
export function decodeArcs(t: Topo): Float32Array[] {
  const sx = t.transform?.scale[0] ?? 1;
  const sy = t.transform?.scale[1] ?? 1;
  const tx = t.transform?.translate[0] ?? 0;
  const ty = t.transform?.translate[1] ?? 0;
  const quantised = !!t.transform;
  return t.arcs.map((arc) => {
    const out = new Float32Array(arc.length * 2);
    let x = 0;
    let y = 0;
    for (let i = 0; i < arc.length; i++) {
      const p = arc[i]!;
      if (quantised) {
        x += p[0]!;
        y += p[1]!;
        out[i * 2] = x * sx + tx;
        out[i * 2 + 1] = y * sy + ty;
      } else {
        out[i * 2] = p[0]!;
        out[i * 2 + 1] = p[1]!;
      }
    }
    return out;
  });
}

/** One ring (arc indices; a negative index is the arc reversed) to lon/lat pairs. */
export function ringPoints(ring: readonly number[], arcs: readonly Float32Array[]): number[] {
  const pts: number[] = [];
  for (const idx of ring) {
    const rev = idx < 0;
    const a = arcs[rev ? ~idx : idx];
    if (!a) continue;
    const n = a.length / 2;
    // Consecutive arcs share their joint point.
    const start = pts.length ? 1 : 0;
    for (let k = start; k < n; k++) {
      const j = rev ? n - 1 - k : k;
      pts.push(a[j * 2]!, a[j * 2 + 1]!);
    }
  }
  return pts;
}

/** Every ring (a list of arc indices) of an object, holes included. */
function ringsIn(obj: TopoObject, out: number[][]): void {
  if (obj.type === 'GeometryCollection') {
    for (const g of obj.geometries ?? []) ringsIn(g, out);
  } else if (obj.type === 'MultiPolygon') {
    for (const poly of (obj.arcs ?? []) as number[][][]) for (const ring of poly) out.push(ring);
  } else if (obj.type === 'Polygon') {
    for (const ring of (obj.arcs ?? []) as number[][]) out.push(ring);
  }
}

/** Every ring of an object as lon/lat pairs. */
export function ringsOf(topo: Topo, name: string): number[][] {
  const arcs = decodeArcs(topo);
  const obj = topo.objects[name];
  if (!obj) return [];
  const rings: number[][] = [];
  ringsIn(obj, rings);
  return rings.map((r) => ringPoints(r, arcs));
}

let cache: Promise<LandMask> | null = null;

/** Loads and rasterises the land once; later calls share the result. */
export function loadLand(): Promise<LandMask> {
  if (cache) return cache;
  const base = import.meta.env.BASE_URL ?? '/';
  cache = fetch(`${base.endsWith('/') ? base : `${base}/`}data/land-110m.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`land data ${r.status}`);
      return r.json() as Promise<Topo>;
    })
    .then((topo) => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2d context');
      const path = new Path2D();
      for (const ring of ringsOf(topo, 'land')) {
        for (let i = 0; i < ring.length; i += 2) {
          const x = ((ring[i]! + 180) / 360) * W;
          const y = ((90 - ring[i + 1]!) / 180) * H;
          if (i === 0) path.moveTo(x, y);
          else path.lineTo(x, y);
        }
        path.closePath();
      }
      ctx.fill(path, 'evenodd');
      const px = ctx.getImageData(0, 0, W, H).data;
      const data = new Uint8Array(W * H);
      for (let i = 0; i < data.length; i++) data[i] = px[i * 4 + 3]! > 127 ? 1 : 0;
      return { w: W, h: H, data };
    })
    .catch((e) => {
      cache = null;
      throw e;
    });
  return cache;
}

/** True when a longitude and latitude fall on land. */
export function isLand(m: LandMask, lon: number, lat: number): boolean {
  let l = lon;
  while (l < -180) l += 360;
  while (l >= 180) l -= 360;
  if (lat <= -90 || lat >= 90) return false;
  const x = Math.min(m.w - 1, Math.floor(((l + 180) / 360) * m.w));
  const y = Math.min(m.h - 1, Math.floor(((90 - lat) / 180) * m.h));
  return m.data[y * m.w + x] === 1;
}
