import { describe, expect, it } from 'vitest';
import { type AnchorEngine, AnchorSystem } from './anchors';
import type { LabelAnchor, LabelAnchorInput, ScreenPoint } from './engine/GlobeEngine';

// Plain objects stand in for DOM nodes (the suite runs in node): the system only writes `style`
// and `setAttribute('d')`, and reads `offsetWidth`/`offsetHeight`.
function el(w = 50, h = 14) {
  return { style: {} as Record<string, string>, offsetWidth: w, offsetHeight: h } as unknown as HTMLElement;
}
function path() {
  const attrs: Record<string, string> = {};
  return {
    attrs,
    setAttribute: (k: string, v: string) => {
      attrs[k] = v;
    },
  } as unknown as SVGPathElement & { attrs: Record<string, string> };
}

function fakeEngine() {
  let inputs: LabelAnchorInput[] = [];
  let frame: (() => void) | null = null;
  const out: LabelAnchor[] = [];
  const e = {
    setCount: 0,
    moon: { x: 900, y: 100, s: 60, r: 44, z: 0, visible: true, hover: false, phase: 0 },
    nodes: new Map<number, { x: number; y: number; visible: boolean }>(),
    setLabelAnchors(list: readonly LabelAnchorInput[]) {
      inputs = [...list];
      this.setCount++;
    },
    // A toy projection: x = lon * 10, y = lat * 10; the far side (|lon| > 90) is occluded.
    labelAnchors() {
      out.length = 0;
      for (const a of inputs)
        out.push({
          id: a.id,
          kind: 'custom',
          text: '',
          x: (a.lon ?? 0) * 10,
          y: (a.lat ?? 0) * 10,
          visible: Math.abs(a.lon ?? 0) <= 90,
          depth: 0,
          facing: Math.abs(a.lon ?? 0) <= 90 ? 1 : -0.5,
        });
      return out;
    },
    projectNode(id: number, o: ScreenPoint) {
      const n = this.nodes.get(id);
      if (!n) return false;
      o.x = n.x;
      o.y = n.y;
      o.visible = n.visible;
      return n.visible;
    },
    moonState() {
      return this.moon;
    },
    on(_t: 'frame', cb: () => void) {
      frame = cb;
      return () => {
        frame = null;
      };
    },
    tick() {
      frame?.();
    },
    get attached() {
      return frame !== null;
    },
  };
  return e;
}

describe('AnchorSystem', () => {
  it('positions labels from the engine frame event and hides occluded ones', () => {
    const e = fakeEngine();
    const a = new AnchorSystem();
    a.attach(e as unknown as AnchorEngine);
    const front = el();
    const back = el();
    a.place(front, { kind: 'world', lat: 20, lon: 30 });
    a.place(back, { kind: 'world', lat: 0, lon: 150 });
    e.tick();
    expect(front.style.transform).toBe('translate3d(300px, 200px, 0)');
    expect(front.style.visibility).toBe('');
    expect(back.style.visibility).toBe('hidden');
    // One engine registration for both anchors, not one per frame.
    e.tick();
    expect(e.setCount).toBe(1);
  });

  it('follows nodes (store ids, shifted for the engine) and the moon', () => {
    const e = fakeEngine();
    e.nodes.set(8, { x: 40, y: 50, visible: true });
    const a = new AnchorSystem();
    a.attach(e as unknown as AnchorEngine);
    const n = el();
    const m = el();
    a.place(n, { kind: 'node', id: 7 }, { dx: 10 });
    a.place(m, { kind: 'moon' });
    e.tick();
    expect(n.style.transform).toBe('translate3d(50px, 50px, 0)');
    expect(m.style.transform).toBe('translate3d(900px, 100px, 0)');
  });

  it('collision-culls a label group in priority order and keeps labels off the moon', () => {
    const e = fakeEngine();
    const a = new AnchorSystem();
    a.attach(e as unknown as AnchorEngine);
    const first = el(80, 14);
    const overlapping = el(80, 14);
    const clear = el(80, 14);
    const onMoon = el(40, 14);
    a.place(overlapping, { kind: 'world', lat: 10, lon: 12 }, { group: 'g', priority: 1 });
    a.place(first, { kind: 'world', lat: 10, lon: 10 }, { group: 'g', priority: 0 });
    a.place(clear, { kind: 'world', lat: 40, lon: 10 }, { group: 'g', priority: 2 });
    a.place(onMoon, { kind: 'point', x: 890, y: 95 }, { group: 'g', priority: 3 });
    e.tick();
    expect(first.style.visibility).toBe('');
    expect(overlapping.style.visibility).toBe('hidden');
    expect(clear.style.visibility).toBe('');
    expect(onMoon.style.visibility).toBe('hidden');
  });

  it('routes a tether with one 45 degree elbow and hides it when an end is hidden', () => {
    const e = fakeEngine();
    e.nodes.set(1, { x: 100, y: 300, visible: true });
    const a = new AnchorSystem();
    a.attach(e as unknown as AnchorEngine);
    const p = path();
    a.tether(p, { kind: 'node', id: 0 }, { kind: 'point', x: 500, y: 100 });
    e.tick();
    expect(p.attrs.d).toBe('M100.0 300.0L300.0 100.0L500.0 100.0');
    e.nodes.set(1, { x: 100, y: 300, visible: false });
    e.tick();
    expect(p.attrs.d).toBe('');
  });

  it('removes placements and detaches from the engine', () => {
    const e = fakeEngine();
    const a = new AnchorSystem();
    a.attach(e as unknown as AnchorEngine);
    const x = el();
    const h = a.place(x, { kind: 'world', lat: 1, lon: 1 });
    h.remove();
    e.tick();
    expect(x.style.transform).toBeUndefined();
    a.dispose();
    expect(e.attached).toBe(false);
  });
});
