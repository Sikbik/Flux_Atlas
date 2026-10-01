import { describe, expect, it } from 'vitest';
import {
  cometFrames,
  cubicBezier,
  fitRadii,
  frameCount,
  insetPolygon,
  Outline,
  parseBezier,
  parseLength,
  parsePolygon,
  parseRadius,
  polygonOutline,
  roundedRect,
  trailFrames,
} from './geometry';

describe('Outline', () => {
  const square = new Outline([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]);

  it('measures the perimeter and wraps arc length', () => {
    expect(square.length).toBe(40);
    expect(square.at(0)).toMatchObject({ x: 0, y: 0, a: 0 });
    expect(square.at(5)).toMatchObject({ x: 5, y: 0 });
    expect(square.at(15).y).toBeCloseTo(5);
    expect(square.at(15).x).toBeCloseTo(10);
    expect(square.at(40).x).toBeCloseTo(0);
    expect(square.at(-5).y).toBeCloseTo(5); // wraps backwards onto the left edge
    expect(square.at(-5).x).toBeCloseTo(0);
  });

  it('heads along the edge it is on', () => {
    expect(square.at(5).a).toBeCloseTo(0);
    expect(square.at(15).a).toBeCloseTo(Math.PI / 2);
    expect(square.at(25).a).toBeCloseTo(Math.PI);
  });

  it('projects a point to the nearest edge position', () => {
    const p = square.project(4, 2);
    expect(p.s).toBeCloseTo(4);
    expect(p.dist).toBeCloseTo(2);
    const q = square.project(11, 5);
    expect(q.s).toBeCloseTo(15);
    expect(q.dist).toBeCloseTo(1);
  });

  it('drops duplicate and closing points', () => {
    const o = new Outline([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 0 },
    ]);
    expect(o.pts).toHaveLength(3);
  });
});

describe('roundedRect', () => {
  it('has the analytic perimeter of a rounded rectangle', () => {
    const w = 120;
    const h = 36;
    const r = 10;
    const o = roundedRect(w, h, [r, r, r, r], 0, Math.PI / 48);
    const exact = 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;
    expect(o.length).toBeGreaterThan(exact * 0.998);
    expect(o.length).toBeLessThanOrEqual(exact + 0.01);
  });

  it('is a plain rectangle with square corners', () => {
    const o = roundedRect(100, 40, [0, 0, 0, 0]);
    expect(o.length).toBeCloseTo(280);
    expect(o.pts).toHaveLength(4);
  });

  it('clamps a pill to half the height and shrinks with the inset', () => {
    const pill = roundedRect(80, 24, [999, 999, 999, 999]);
    // Radius clamps to 12: the straight runs are 56 long, the arcs make one full circle.
    expect(pill.length).toBeGreaterThan(2 * 56 + 2 * Math.PI * 12 * 0.99);
    const inner = roundedRect(80, 24, [12, 12, 12, 12], 1.5);
    expect(inner.length).toBeLessThan(pill.length);
    const bb = inner.pts.reduce((m, p) => ({ minX: Math.min(m.minX, p.x), maxX: Math.max(m.maxX, p.x) }), {
      minX: 1e9,
      maxX: -1e9,
    });
    expect(bb.minX).toBeCloseTo(1.5);
    expect(bb.maxX).toBeCloseTo(78.5);
  });

  it('scales radii like CSS when two on a side overflow it', () => {
    const [tl, tr] = fitRadii(20, 100, [15, 15, 0, 0]);
    expect(tl).toBeCloseTo(10);
    expect(tr).toBeCloseTo(10);
  });
});

describe('polygons', () => {
  it('parses a computed chamfer clip-path', () => {
    const pts = parsePolygon(
      'polygon(0px 0px, calc(100% - 14px) 0px, 100% 8px, 100% 100%, 0px 100%)',
      100,
      36,
    );
    expect(pts).toEqual([
      { x: 0, y: 0 },
      { x: 86, y: 0 },
      { x: 100, y: 8 },
      { x: 100, y: 36 },
      { x: 0, y: 36 },
    ]);
  });

  it('parses the dual chamfer and fill rules, rejects what it cannot read', () => {
    const dual = parsePolygon(
      'polygon(evenodd, 0 0, calc(100% - 14px) 0, 100% 8px, 100% 100%, 14px 100%, 0 calc(100% - 8px))',
      90,
      32,
    );
    expect(dual).toHaveLength(6);
    expect(dual?.[5]).toEqual({ x: 0, y: 24 });
    expect(parsePolygon('circle(50%)', 10, 10)).toBeNull();
    expect(parsePolygon('polygon(0 0, 10 foo)', 10, 10)).toBeNull();
    expect(parsePolygon('none', 10, 10)).toBeNull();
  });

  it('insets a clockwise polygon on every edge', () => {
    const box = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 0, y: 40 },
    ];
    const inner = insetPolygon(box, 2);
    expect(inner[0]).toMatchObject({ x: 2, y: 2 });
    expect(inner[2]).toMatchObject({ x: 98, y: 38 });
    expect(polygonOutline(box, 2).length).toBeCloseTo(2 * 96 + 2 * 36);
  });

  it('insets a chamfered corner along its diagonal', () => {
    const chamfer = [
      { x: 0, y: 0 },
      { x: 86, y: 0 },
      { x: 100, y: 8 },
      { x: 100, y: 36 },
      { x: 0, y: 36 },
    ];
    const inner = insetPolygon(chamfer, 1.5);
    // The diagonal edge moved inward: its two vertices are strictly inside the original.
    expect(inner[1]!.x).toBeLessThan(86);
    expect(inner[2]!.x).toBeLessThan(100);
    expect(inner[2]!.y).toBeGreaterThan(8);
  });
});

describe('css lengths', () => {
  it('resolves px, percent and calc', () => {
    expect(parseLength('12px', 100)).toBe(12);
    expect(parseLength('25%', 80)).toBe(20);
    expect(parseLength('calc(100% - 14px)', 100)).toBe(86);
    expect(parseLength('calc(50% + 4px - 2px)', 100)).toBe(52);
    expect(parseLength('auto', 100)).toBeNull();
  });

  it('reads a computed corner radius', () => {
    expect(parseRadius('10px', 100, 40)).toBe(10);
    expect(parseRadius('50%', 100, 40)).toBe(20);
    expect(parseRadius('10px 6px', 100, 40)).toBe(6);
    expect(parseRadius('0px', 100, 40)).toBe(0);
  });
});

describe('cometFrames', () => {
  const o = roundedRect(100, 40, [10, 10, 10, 10], 0.75);

  it('starts at the press point on the edge and ends at the opposite side', () => {
    const s0 = o.project(50, 0).s;
    const half = o.length / 2;
    const cw = cometFrames(o, s0, 1, half, 24);
    const ccw = cometFrames(o, s0, -1, half, 24);
    expect(cw).toHaveLength(25);
    const start = o.at(s0);
    expect(cw[0]).toMatchObject({ x: start.x, y: start.y });
    expect(ccw[0]).toMatchObject({ x: start.x, y: start.y });
    // Both heads meet on the far side.
    const a = cw[24]!;
    const b = ccw[24]!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.01);
    expect(a.y).toBeGreaterThan(30); // bottom edge
  });

  it('keeps every sampled point on the outline', () => {
    const s0 = o.project(20, 0).s;
    for (const dir of [1, -1] as const) {
      for (const f of cometFrames(o, s0, dir, o.length / 2, 40)) {
        expect(o.project(f.x, f.y).dist).toBeLessThan(0.05);
      }
    }
  });

  it('unwraps the heading so interpolation never spins backwards', () => {
    for (const dir of [1, -1] as const) {
      const frames = cometFrames(o, 0, dir, o.length * 0.9, 60);
      for (let i = 1; i < frames.length; i++) {
        expect(Math.abs(frames[i]!.a - frames[i - 1]!.a)).toBeLessThan(Math.PI / 2);
      }
    }
  });

  it('heads backwards when travelling counter-clockwise', () => {
    const s0 = o.project(50, 0).s;
    const cw = cometFrames(o, s0, 1, 10, 4);
    const ccw = cometFrames(o, s0, -1, 10, 4);
    expect(Math.cos(cw[1]!.a)).toBeGreaterThan(0.9); // top edge, travelling right
    expect(Math.cos(ccw[1]!.a)).toBeLessThan(-0.9); // top edge, travelling left
  });

  it('sizes the keyframe count to the path', () => {
    expect(frameCount(10)).toBe(8);
    expect(frameCount(100)).toBe(25);
    expect(frameCount(10_000)).toBe(48);
  });
});

describe('cubicBezier', () => {
  const run = cubicBezier(0.33, 0.4, 0.5, 1);

  it('runs from 0 to 1 and never goes backwards', () => {
    expect(run.at(0)).toBe(0);
    expect(run.at(1)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 50; i++) {
      const v = run.at(i / 50);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('inverts itself', () => {
    for (const t of [0.05, 0.2, 0.5, 0.8, 0.95]) expect(run.inverse(run.at(t))).toBeCloseTo(t, 4);
  });

  it('matches the CSS keyword ease-out shape: fast first, slow last', () => {
    const out = cubicBezier(0.22, 1, 0.36, 1);
    expect(out.at(0.2)).toBeGreaterThan(0.5);
    expect(out.at(0.9) - out.at(0.8)).toBeLessThan(0.05);
  });

  it('parses a cubic-bezier() string', () => {
    const b = parseBezier('cubic-bezier(0.33, 0.4, 0.5, 1)');
    expect(b?.at(0.5)).toBeCloseTo(run.at(0.5), 6);
    expect(parseBezier('ease-out')).toBeNull();
  });
});

describe('trailFrames', () => {
  const o = roundedRect(100, 40, [10, 10, 10, 10], 0.75);
  const ease = cubicBezier(0.33, 0.4, 0.5, 1);
  const s0 = o.project(50, 0).s;
  const half = o.length / 2;

  it('keeps every sample on the outline', () => {
    for (const dir of [1, -1] as const) {
      for (const lag of [0, 6, 24]) {
        for (const f of trailFrames(o, s0, dir, half, lag, ease, 4, 3)) {
          expect(o.project(f.x, f.y).dist).toBeLessThan(0.05);
        }
      }
    }
  });

  it('has strictly increasing offsets that start at 0 and end at 1', () => {
    for (const lag of [0, 6, 24]) {
      const frames = trailFrames(o, s0, 1, half, lag, ease, 4, 3);
      expect(frames[0]!.offset).toBe(0);
      expect(frames[frames.length - 1]!.offset).toBe(1);
      for (let i = 1; i < frames.length; i++)
        expect(frames[i]!.offset).toBeGreaterThan(frames[i - 1]!.offset);
    }
  });

  it('holds the origin until the head has covered the lag, then follows it', () => {
    const head = trailFrames(o, s0, 1, half, 0, ease, 4, 3);
    const tail = trailFrames(o, s0, 1, half, 12, ease, 4, 3);
    // The lagging segment waits at the origin for exactly as long as the head takes to cover 12 px.
    expect(tail[0]).toMatchObject({ offset: 0 });
    expect(tail[1]!.offset).toBeCloseTo(ease.inverse(12 / half), 3);
    expect(tail[0]!.x).toBeCloseTo(tail[1]!.x, 6);
    // At the end it is 12 px behind the head along the path.
    const a = head[head.length - 1]!;
    const b = tail[tail.length - 1]!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(8);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThanOrEqual(12.01);
  });

  it('gives nothing for a segment that never starts', () => {
    expect(trailFrames(o, s0, 1, half, half, ease, 4)).toEqual([]);
    expect(trailFrames(o, s0, 1, half, half + 5, ease, 4)).toEqual([]);
  });

  it('points along the chord, never off the path at a corner', () => {
    // Walk a segment through the top-right corner: its heading follows the corner round.
    const frames = trailFrames(o, o.project(80, 0).s, 1, 60, 0, ease, 3, 1.5);
    const first = frames[0]!.a;
    const last = frames[frames.length - 1]!.a;
    expect(Math.abs(first)).toBeLessThan(0.15); // along the top edge, heading right
    expect(last).toBeGreaterThan(Math.PI / 2 - 0.2); // heading down the right edge
    // Interpolating the heading between samples never turns more than a quarter turn.
    for (let i = 1; i < frames.length; i++)
      expect(Math.abs(frames[i]!.a - frames[i - 1]!.a)).toBeLessThan(Math.PI / 3);
  });

  it('points the other way when travelling counter-clockwise', () => {
    const ccw = trailFrames(o, s0, -1, half, 0, ease, 4, 3);
    expect(Math.cos(ccw[1]!.a)).toBeLessThan(-0.9); // along the top edge, heading left
  });
});
