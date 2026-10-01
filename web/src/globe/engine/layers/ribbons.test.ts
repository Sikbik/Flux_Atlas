import { describe, expect, it } from 'vitest';
import type { CameraRig } from '../camera';
import type { Fx } from '../fx';
import type { MeshStore } from '../nodes/mesh';
import type { NodeStore } from '../nodes/store';
import { MeshVeil } from '../nodes/veil';
import { createSharedUniforms } from '../uniforms';
import { RibbonLayer, RibbonStyle } from './ribbons';

const add = (l: RibbonLayer, t: number, life = 30) =>
  l.add(1, 2, RibbonStyle.Link, t, 1, life, -1, 1, 1, 1, 1, 0.1);

describe('RibbonLayer.fadeAll (leaving the mesh flow)', () => {
  it('retires every live ribbon, tracked or not, within the fade', () => {
    const l = new RibbonLayer(createSharedUniforms(), 64, 8);
    for (let i = 0; i < 20; i++) add(l, i * 0.1);
    expect(l.count).toBe(20);
    l.fadeAll(5, 0.8);
    l.update(5.5);
    expect(l.count).toBe(20); // still fading
    l.update(5.9);
    expect(l.count).toBe(0);
  });

  it('keeps what the caller asks to keep', () => {
    const l = new RibbonLayer(createSharedUniforms(), 64, 8);
    const a = add(l, 0);
    add(l, 0);
    l.fadeAll(1, 0.5, (i) => i === a);
    l.update(2);
    expect(l.count).toBe(1);
    expect(l.isActive(a, 0)).toBe(true);
  });
});

describe('MeshVeil.showEdge', () => {
  it('retires the ribbon an edge already had instead of orphaning it', () => {
    const links = new RibbonLayer(createSharedUniforms(), 64, 8);
    const mesh = {
      sa: new Uint32Array([3]),
      sb: new Uint32Array([4]),
      link: new Int32Array([-1]),
      linkStart: new Float32Array([0]),
    } as unknown as MeshStore;
    const veil = new MeshVeil(
      {} as NodeStore,
      mesh,
      links,
      {} as Fx,
      { lodRange: 3.6 } as unknown as CameraRig,
    );
    const c = { r: 1, g: 1, b: 1 };
    const first = veil.showEdge(0, 0, 1, c);
    const second = veil.showEdge(0, 1, 1, c);
    expect(second).not.toBe(first);
    links.update(1.5);
    // The first ribbon faded out; only the re-shown one is live.
    expect(links.count).toBe(1);
    expect(links.isActive(second, 1)).toBe(true);
  });
});
