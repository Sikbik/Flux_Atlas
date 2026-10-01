import { describe, expect, it } from 'vitest';
import { KNOCK_FRAG, NODE_FRAG, NODE_VERT } from './nodeShaders';

// The shaders only compile in a browser, so these checks catch the mistakes that would otherwise show up
// as a black frame: a varying the fragment stage reads but the vertex stage never writes (or writes with a
// different type), and the knock variant's vertex branch.

/** `out`/`in` declarations: name -> type, ignoring qualifiers such as flat. */
function declared(src: string, dir: 'in' | 'out'): Map<string, string> {
  const m = new Map<string, string>();
  const re = new RegExp(
    `^\\s*(?:flat\\s+)?${dir}\\s+(?:highp\\s+|mediump\\s+|lowp\\s+)?(\\w+)\\s+(\\w+)\\s*;`,
    'gm',
  );
  for (const hit of src.matchAll(re)) m.set(hit[2]!, hit[1]!);
  return m;
}

describe('node shaders', () => {
  const vertOut = declared(NODE_VERT, 'out');

  it('every varying the marker pass reads is written by the vertex stage, with the same type', () => {
    const fragIn = declared(NODE_FRAG, 'in');
    expect(fragIn.size).toBeGreaterThan(0);
    for (const [name, type] of fragIn) expect(vertOut.get(name), `varying ${name}`).toBe(type);
  });

  it('every varying the knock pass reads is written by the vertex stage, with the same type', () => {
    const fragIn = declared(KNOCK_FRAG, 'in');
    expect(fragIn.size).toBeGreaterThan(0);
    for (const [name, type] of fragIn) expect(vertOut.get(name), `varying ${name}`).toBe(type);
  });

  it('the knock branch writes every varying it declares before returning', () => {
    // The #ifdef NODE_KNOCK block returns early: it must assign the varyings the knock fragment reads.
    const block = NODE_VERT.slice(NODE_VERT.indexOf('#ifdef NODE_KNOCK'), NODE_VERT.indexOf('#endif'));
    for (const name of declared(KNOCK_FRAG, 'in').keys())
      expect(block, `knock branch sets ${name}`).toContain(name);
  });

  it('shares the lens ramp with the basemaps (one definition)', () => {
    expect(NODE_VERT).toContain('float lensZoom(float camDist, float pprScale)');
    expect(NODE_FRAG).not.toContain('float lensZoom(');
  });

  it('keeps a reduced-motion path for the lock ring and the pulse', () => {
    expect(NODE_FRAG).toContain('uReduced');
    expect(KNOCK_FRAG).toContain('uReduced');
  });

  it('declares no emoji or non-ASCII characters', () => {
    for (const src of [NODE_VERT, NODE_FRAG, KNOCK_FRAG])
      expect([...src].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
  });
});
