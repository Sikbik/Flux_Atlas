import { describe, expect, it } from 'vitest';
import { chooseBoot, markBooted } from './mode';

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};

const base = { reduced: false, search: '', automated: false, local: null, session: null };

describe('chooseBoot', () => {
  it('plays the first-visit boot to a browser that has never booted', () => {
    expect(chooseBoot({ ...base, local: mem(), session: mem() })).toBe('first');
  });

  it('plays the full boot at its own pace to a returning visitor', () => {
    expect(chooseBoot({ ...base, local: mem({ 'atlas.boot.seen.v1': '1' }), session: mem() })).toBe('return');
  });

  it('fades within the same session', () => {
    expect(
      chooseBoot({
        ...base,
        local: mem({ 'atlas.boot.seen.v1': '1' }),
        session: mem({ 'atlas.boot.session.v1': '1' }),
      }),
    ).toBe('instant');
  });

  it('cross-fades under reduced motion', () => {
    expect(chooseBoot({ ...base, reduced: true, local: mem(), session: mem() })).toBe('reduced');
  });

  it('gives a driven browser the quick path unless the URL asks for the show', () => {
    expect(chooseBoot({ ...base, automated: true, local: mem(), session: mem() })).toBe('instant');
    expect(chooseBoot({ ...base, automated: true, search: '?boot=full', local: mem(), session: mem() })).toBe(
      'first',
    );
  });

  it('skips on request, always', () => {
    expect(chooseBoot({ ...base, search: '?x=1&boot=off', local: mem(), session: mem() })).toBe('instant');
    expect(chooseBoot({ ...base, search: '?boot=off', reduced: true })).toBe('instant');
  });

  it('survives storage that throws', () => {
    const bad = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(chooseBoot({ ...base, local: bad, session: bad })).toBe('first');
    expect(() => markBooted(bad, bad)).not.toThrow();
  });
});

describe('markBooted', () => {
  it('remembers the browser and the tab', () => {
    const local = mem();
    const session = mem();
    markBooted(local, session);
    expect(chooseBoot({ ...base, local, session })).toBe('instant');
    expect(chooseBoot({ ...base, local, session: mem() })).toBe('return');
  });
});
