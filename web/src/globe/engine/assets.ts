// Asset loading: textures, the land mask (rasterized from Natural Earth TopoJSON) and border
// segments. A small TopoJSON decoder lives here so the engine has no dependencies besides three.

import * as THREE from 'three';

export interface TopoTopology {
  type: 'Topology';
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: Record<string, TopoObject>;
}
interface TopoObject {
  type: string;
  geometries?: TopoObject[];
  arcs?: number[][] | number[][][];
}

function join(base: string, path: string): string {
  if (!base) return path;
  return base.endsWith('/') ? base + path : `${base}/${path}`;
}

export async function loadJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

/** Decodes quantized, delta-encoded TopoJSON arcs to absolute lon/lat pairs (Float32Array each). */
export function decodeArcs(topo: TopoTopology): Float32Array[] {
  const sx = topo.transform?.scale[0] ?? 1;
  const sy = topo.transform?.scale[1] ?? 1;
  const tx = topo.transform?.translate[0] ?? 0;
  const ty = topo.transform?.translate[1] ?? 0;
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

/** Collects the ring (as arc index lists) of every polygon in an object. */
function collectRings(obj: TopoObject, rings: number[][]): void {
  if (obj.type === 'GeometryCollection') {
    for (const g of obj.geometries ?? []) collectRings(g, rings);
  } else if (obj.type === 'Polygon') {
    for (const ring of (obj.arcs ?? []) as number[][]) rings.push(ring);
  } else if (obj.type === 'MultiPolygon') {
    for (const poly of (obj.arcs ?? []) as number[][][]) for (const ring of poly) rings.push(ring);
  }
}

/** Expands a ring of (possibly reversed) arc indices into one lon/lat polyline. */
function ringToPoints(ring: number[], arcs: Float32Array[], out: number[]): void {
  for (const idx of ring) {
    const rev = idx < 0;
    const a = arcs[rev ? ~idx : idx]!;
    const n = a.length / 2;
    // Skip the first point of every arc after the first: it repeats the previous arc's last point.
    const startAt = out.length === 0 ? 0 : 1;
    if (!rev) {
      for (let i = startAt; i < n; i++) out.push(a[i * 2]!, a[i * 2 + 1]!);
    } else {
      for (let i = n - 1 - startAt; i >= 0; i--) out.push(a[i * 2]!, a[i * 2 + 1]!);
    }
  }
}

export interface LandMask {
  width: number;
  height: number;
  /** 0..255 coverage, row 0 = north. */
  data: Uint8Array;
  texture: THREE.DataTexture;
}

/**
 * Rasterizes the land polygons into an equirectangular mask. Uses an OffscreenCanvas when the
 * browser has one. Coverage is anti-aliased, so linear filtering gives clean coasts at any zoom.
 */
export async function buildLandMask(base: string, width = 2048): Promise<LandMask> {
  // The coarse 1:110m outlines are plenty for the small mask the low tier uses.
  const topo = await loadJson<TopoTopology>(
    join(base, width > 1024 ? 'data/land-50m.json' : 'data/land-110m.json'),
  );
  const arcs = decodeArcs(topo);
  const rings: number[][] = [];
  const land = topo.objects.land;
  if (land) collectRings(land, rings);
  const height = width / 2;
  const make = (): OffscreenCanvas | HTMLCanvasElement => {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  };
  const canvas = make();
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  const pts: number[] = [];
  const sx = width / 360;
  const sy = height / 180;
  ctx.beginPath();
  for (const ring of rings) {
    pts.length = 0;
    ringToPoints(ring, arcs, pts);
    for (let i = 0; i < pts.length; i += 2) {
      const x = (pts[i]! + 180) * sx;
      const y = (90 - pts[i + 1]!) * sy;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.fill('evenodd');
  const img = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = img[i * 4]!;
  // DataTexture rows start at v = 0 (the south pole), so the north-first raster is uploaded flipped.
  const gpu = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    gpu.set(data.subarray(y * width, (y + 1) * width), (height - 1 - y) * width);
  const texture = new THREE.DataTexture(gpu, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  texture.name = 'land-mask';
  return { width, height, data, texture };
}

export interface BorderSegments {
  /** lat0, lon0, lat1, lon1 per segment for coastlines. */
  coast: Float32Array;
  /** Same layout for interior borders. */
  border: Float32Array;
}

/** Extracts every arc of the country topology once, split into coastline and shared border. */
export async function loadBorders(base: string, fine = true): Promise<BorderSegments> {
  const topo = await loadJson<TopoTopology>(
    join(base, fine ? 'data/countries-50m.json' : 'data/countries-110m.json'),
  );
  const arcs = decodeArcs(topo);
  const uses = new Uint8Array(arcs.length);
  const rings: number[][] = [];
  const countries = topo.objects.countries;
  if (countries) collectRings(countries, rings);
  for (const ring of rings) for (const idx of ring) uses[idx < 0 ? ~idx : idx]!++;
  let coastN = 0;
  let borderN = 0;
  arcs.forEach((a, i) => {
    const segs = a.length / 2 - 1;
    if (uses[i]! >= 2) borderN += segs;
    else coastN += segs;
  });
  const coast = new Float32Array(coastN * 4);
  const border = new Float32Array(borderN * 4);
  let ci = 0;
  let bi = 0;
  arcs.forEach((a, i) => {
    const target = uses[i]! >= 2 ? border : coast;
    let o = uses[i]! >= 2 ? bi : ci;
    for (let k = 0; k < a.length / 2 - 1; k++) {
      target[o++] = a[k * 2 + 1]!;
      target[o++] = a[k * 2]!;
      target[o++] = a[k * 2 + 3]!;
      target[o++] = a[k * 2 + 2]!;
    }
    if (uses[i]! >= 2) bi = o;
    else ci = o;
  });
  return { coast, border };
}

export interface EarthImages {
  day: HTMLImageElement;
  night: HTMLImageElement;
  clouds: HTMLImageElement;
}

export function textureFromImage(
  img: HTMLImageElement,
  srgb: boolean,
  renderer: THREE.WebGLRenderer,
  name: string,
): THREE.Texture {
  const t = new THREE.Texture(img);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.name = name;
  t.needsUpdate = true;
  return t;
}

/** Reads an image's pixels at a reduced size (for CPU-side sampling). */
export function readPixels(img: HTMLImageElement, width: number, height: number): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.drawImage(img, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

export { join as joinUrl };
