// The Flux symbol as four solid blocks.
//
// The outlines are the official brand asset, assets/brand/flux/symbol/Flux_symbol-mark_blue.svg
// (Flux Brand Book v2.0, "Logo Overview"): three blocks that together function as one block. The
// polygons below are that file's four paths with their `translate()` transforms already applied,
// so the silhouette is exact. Nothing about the shape is altered; this module only gives each
// polygon depth and a bevel. Seen from the front the result is the symbol, unchanged.
//
// Brand rules that bind everything built from this geometry: colors stay in the brand family
// (Flux blue, white, black, gray, and the book's tonal blues), the proportions never change, and
// the mark gets no outline or border. Pieces may move apart and lock back together; they are
// never recolored, stretched or re-arranged.

import * as THREE from 'three';

/** Piece indices. They are also the anchor indices the ray layer uses for the moon. */
export const Piece = { Parallelogram: 0, SmallHex: 1, BigHex: 2, Cap: 3 } as const;

/**
 * Official outlines. `d` is the path data of the brand SVG, `tx`/`ty` its translate transform.
 * Only straight segments (M, L, H, V, Z in both cases) occur; anything else throws.
 */
const PATHS = [
  { name: 'parallelogram', d: 'M175.03,202.425l-28.9,16.7L84.03,183.28l28.2-16.285.7-.414,1.077.622Z', tx: -6.271, ty: 103.85, depth: 30 },
  { name: 'small hexagon', d: 'M135.884,141.366v51.591L91.192,218.774,46.5,192.957V141.366l44.692-25.8Z', tx: -46.5, ty: 49.17, depth: 62 },
  { name: 'big hexagon', d: 'M261.9,132.948v89.715l-77.7,44.858-.1-.062-77.594-44.8V132.948L184.2,88.07Z', tx: 17.819, ty: 19.693, depth: 96 },
  {
    name: 'cap',
    d: 'M326.213,116.8v33.607L265.09,115.125l-16.576-9.572-16.576,9.572-77.7,44.858-16.576,9.572v19.787l-29.9-17.259-16.576-9.572-16.576,9.572L46.5,188.307V116.8L186.356,36.06Z',
    tx: -46.5,
    ty: -36.06,
    depth: 50,
  },
] as const;

/** Bevel, in symbol units (the symbol is about 280 by 323). */
const BEVEL_T = 4.6;
const BEVEL_S = 3.6;

export interface SymbolPiece {
  name: string;
  /** Centroid of the polygon, symbol units, y up, origin at the symbol's bounding-box center. */
  cx: number;
  cy: number;
  /** Extrusion depth (without bevel) and the z of the front face. */
  depth: number;
  front: number;
  /** Polygon vertices (x, y pairs), same frame as the centroid. */
  poly: Float32Array;
  /** Bounding radius about the centroid. */
  radius: number;
}

export interface SymbolModel {
  geometry: THREE.BufferGeometry;
  pieces: SymbolPiece[];
  width: number;
  height: number;
  /** Bounding sphere radius of the whole symbol in symbol units (covers the depth too). */
  radius: number;
}

function parsePolygon(d: string): [number, number][] {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g);
  if (!toks) throw new Error('empty path');
  const pts: [number, number][] = [];
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const num = (): number => parseFloat(toks[i++]);
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    switch (cmd) {
      case 'M': x = num(); y = num(); sx = x; sy = y; pts.push([x, y]); cmd = 'L'; break;
      case 'm': x += num(); y += num(); sx = x; sy = y; pts.push([x, y]); cmd = 'l'; break;
      case 'L': x = num(); y = num(); pts.push([x, y]); break;
      case 'l': x += num(); y += num(); pts.push([x, y]); break;
      case 'H': x = num(); pts.push([x, y]); break;
      case 'h': x += num(); pts.push([x, y]); break;
      case 'V': y = num(); pts.push([x, y]); break;
      case 'v': y += num(); pts.push([x, y]); break;
      case 'Z':
      case 'z': x = sx; y = sy; break;
      default: throw new Error(`unsupported path command ${cmd}`);
    }
  }
  // Drop the sub-pixel jogs the artwork carries (0.7 unit steps) and any closing duplicate.
  const out: [number, number][] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.35) out.push(p);
  }
  const f = out[0];
  const l = out[out.length - 1];
  if (out.length > 2 && Math.hypot(f[0] - l[0], f[1] - l[1]) < 0.35) out.pop();
  return out;
}

export function buildSymbol(): SymbolModel {
  // Absolute polygons first, to find the bounding box.
  const polys = PATHS.map((p) => parsePolygon(p.d).map(([x, y]) => [x + p.tx, y + p.ty] as [number, number]));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const ox = (minX + maxX) / 2;
  const oy = (minY + maxY) / 2;

  const pieces: SymbolPiece[] = [];
  const geoms: THREE.BufferGeometry[] = [];
  let maxR = 0;
  for (let k = 0; k < PATHS.length; k++) {
    // SVG is y-down: flip so the symbol is upright in a y-up world.
    const pts = polys[k].map(([x, y]) => new THREE.Vector2(x - ox, oy - y));
    // The flip reverses winding; ExtrudeGeometry wants counter-clockwise for a front face at +z.
    if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const f = a.x * b.y - b.x * a.y;
      area += f;
      cx += (a.x + b.x) * f;
      cy += (a.y + b.y) * f;
    }
    area /= 2;
    cx /= 6 * area;
    cy /= 6 * area;
    let radius = 0;
    const poly = new Float32Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) {
      poly[i * 2] = pts[i].x;
      poly[i * 2 + 1] = pts[i].y;
      radius = Math.max(radius, Math.hypot(pts[i].x - cx, pts[i].y - cy));
    }
    const depth = PATHS[k].depth;
    const shape = new THREE.Shape(pts);
    // Side walls sit on the brand outline (bevelOffset pulls the faces in by the bevel size), so
    // the silhouette from the front is exactly the symbol.
    const g = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: BEVEL_T,
      bevelSize: BEVEL_S,
      bevelOffset: -BEVEL_S,
      bevelSegments: 2,
      steps: 1,
      curveSegments: 1,
    });
    g.translate(0, 0, -depth / 2); // mid-plane at z = 0
    g.deleteAttribute('uv');
    geoms.push(g);
    pieces.push({ name: PATHS[k].name, cx, cy, depth, front: depth / 2 + BEVEL_T, poly, radius });
    for (const p of pts) maxR = Math.max(maxR, Math.hypot(p.x, p.y, depth / 2 + BEVEL_T));
  }

  // One buffer with a piece index per vertex, so the whole symbol is a single draw call and the
  // vertex shader moves each block on its own.
  let total = 0;
  for (const g of geoms) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const pc = new Float32Array(total);
  let o = 0;
  geoms.forEach((g, k) => {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    pos.set(p.array as Float32Array, o * 3);
    nor.set(n.array as Float32Array, o * 3);
    pc.fill(k, o, o + p.count);
    o += p.count;
    g.dispose();
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('aPiece', new THREE.BufferAttribute(pc, 1));
  geometry.computeBoundingSphere();
  return { geometry, pieces, width, height, radius: maxR };
}
