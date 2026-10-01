import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_COUNT, ACHIEVEMENTS, achievementById } from './catalog';
import { CONTINENTS, continentOf } from './continents';
import { evaluate, type Facts, windowsOf } from './evaluate';
import type { AchievementEvent } from './events';
import { EMPTY, type Progress, parseAchievements } from './state';

const fresh = (over: Partial<Facts> = {}): Facts => ({
  unlocked: new Set(),
  progress: { ...EMPTY.progress, continents: [] },
  ...over,
});

const route = (pathname: string, search: Record<string, unknown> = {}): AchievementEvent => ({
  type: 'route',
  pathname,
  search,
});

describe('the catalogue', () => {
  it('has the canonical twenty-four, numbered in order, with unique ids', () => {
    expect(ACHIEVEMENT_COUNT).toBe(24);
    expect(ACHIEVEMENTS.map((a) => a.n)).toEqual(Array.from({ length: 24 }, (_v, i) => i + 1));
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(24);
    expect(achievementById('first-contact')?.name).toBe('First contact');
    expect(achievementById('nope')).toBeUndefined();
  });

  it('writes in sentences, with no emoji and a goal only on counted ones', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.said.length).toBeGreaterThan(2);
      expect(a.how.length).toBeGreaterThan(5);
      expect(`${a.name}${a.how}${a.said}`).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    expect(ACHIEVEMENTS.filter((a) => a.goal).map((a) => a.id)).toEqual([
      'six-continents',
      'witness',
      'palette-native',
      'shell-script',
    ]);
    expect(ACHIEVEMENTS.filter((a) => a.hidden).map((a) => a.id)).toEqual(['easter-egg']);
  });
});

describe('continents', () => {
  it('maps country codes to six continents', () => {
    expect(continentOf('FI')).toBe('Europe');
    expect(continentOf('us')).toBe('North America');
    expect(continentOf('BR')).toBe('South America');
    expect(continentOf('ZA')).toBe('Africa');
    expect(continentOf('JP')).toBe('Asia');
    expect(continentOf('NZ')).toBe('Oceania');
    expect(continentOf('ZZ')).toBeNull();
    expect(CONTINENTS).toHaveLength(6);
  });
});

describe('route rules', () => {
  it('reads the windows a URL shows, the path and the ?w= extras', () => {
    expect([...windowsOf('/node/5.0.0.1:16127', { w: 'queue,terminal' })].sort()).toEqual([
      'node',
      'queue',
      'terminal',
    ]);
    expect([...windowsOf('/', {})]).toEqual([]);
  });

  it('unlocks the view achievements from where you are', () => {
    expect(evaluate(route('/about'), fresh()).unlock).toEqual(['first-contact']);
    expect(evaluate(route('/node/abc'), fresh()).unlock).toEqual(['hello-node']);
    expect(evaluate(route('/host/5.0.0.1'), fresh()).unlock).toEqual(['fan-out']);
    expect(evaluate(route('/app/Foo'), fresh()).unlock).toEqual(['constellation']);
    expect(evaluate(route('/app/Foo/history/3'), fresh()).unlock).toEqual(['constellation', 'archaeologist']);
    expect(evaluate(route('/time'), fresh()).unlock).toEqual(['time-traveller']);
    expect(evaluate(route('/queue/stratus'), fresh()).unlock).toEqual(['the-queue']);
    expect(evaluate(route('/operator/t1abc'), fresh()).unlock).toEqual(['landlord']);
  });

  it('counts windows riding in ?w= and ignores what is already unlocked', () => {
    expect(evaluate(route('/', { w: 'about' }), fresh()).unlock).toEqual(['first-contact']);
    expect(evaluate(route('/about'), fresh({ unlocked: new Set(['first-contact']) })).unlock).toEqual([]);
  });
});

describe('counted rules', () => {
  it('unlocks Six continents on the sixth different one', () => {
    let f = fresh();
    const names = ['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'];
    names.forEach((c, i) => {
      const out = evaluate({ type: 'node.focus', id: i, continent: c }, f);
      expect(out.unlock).toEqual(i === 5 ? ['six-continents'] : []);
      f = { ...f, progress: out.progress };
    });
    // The same continent twice adds nothing.
    expect(evaluate({ type: 'node.focus', id: 9, continent: 'Asia' }, f).progress.continents).toHaveLength(6);
  });

  it('counts ten keyboard palette opens, and only keyboard ones', () => {
    let p: Progress = { ...EMPTY.progress, continents: [] };
    for (let i = 0; i < 9; i++) {
      p = evaluate({ type: 'palette', action: 'open', via: 'key' }, fresh({ progress: p })).progress;
    }
    expect(evaluate({ type: 'palette', action: 'open', via: 'url' }, fresh({ progress: p })).unlock).toEqual(
      [],
    );
    expect(evaluate({ type: 'palette', action: 'open', via: 'key' }, fresh({ progress: p })).unlock).toEqual([
      'palette-native',
    ]);
  });

  it('counts ten terminal commands and rewards a stream at once', () => {
    let p: Progress = { ...EMPTY.progress, continents: [] };
    for (let i = 0; i < 9; i++) {
      const out = evaluate(
        { type: 'terminal', name: 'help', ok: true, streams: false },
        fresh({ progress: p }),
      );
      expect(out.unlock).toEqual([]);
      p = out.progress;
    }
    expect(
      evaluate({ type: 'terminal', name: 'help', ok: true, streams: false }, fresh({ progress: p })).unlock,
    ).toEqual(['shell-script']);
    expect(evaluate({ type: 'terminal', name: 'tail', ok: true, streams: true }, fresh()).unlock).toEqual([
      'tail-f',
    ]);
  });

  it('counts ten watched blocks in a visit, not blocks the tab could not see', () => {
    const block = (watching: boolean): AchievementEvent => ({
      type: 'block',
      height: 1,
      watching,
      paidWatched: false,
      paidFocused: false,
      announcedFirst: false,
    });
    let p: Progress = { ...EMPTY.progress, continents: [] };
    for (let i = 0; i < 9; i++) p = evaluate(block(true), fresh({ progress: p })).progress;
    expect(evaluate(block(false), fresh({ progress: p })).unlock).toEqual([]);
    expect(evaluate(block(true), fresh({ progress: p })).unlock).toEqual(['witness']);
  });
});

describe('event rules', () => {
  it('pays a watched node and a pre-aimed payee', () => {
    const base = { type: 'block', height: 5, watching: true, announcedFirst: false } as const;
    expect(evaluate({ ...base, paidWatched: true, paidFocused: true }, fresh()).unlock).toEqual(['payday']);
    expect(
      evaluate({ ...base, paidWatched: false, paidFocused: true, announcedFirst: true }, fresh()).unlock,
    ).toEqual(['on-target']);
    expect(evaluate({ ...base, paidWatched: false, paidFocused: true }, fresh()).unlock).toEqual([]);
  });

  it('unlocks the single-event ones', () => {
    const one = (e: AchievementEvent) => evaluate(e, fresh()).unlock;
    expect(one({ type: 'zoom', band: 3 })).toEqual(['close-up']);
    expect(one({ type: 'zoom', band: 2 })).toEqual([]);
    expect(one({ type: 'watched', count: 1 })).toEqual(['watcher']);
    expect(one({ type: 'watched', count: 0 })).toEqual([]);
    expect(one({ type: 'ui', what: 'copy' })).toEqual(['link-sharer']);
    expect(one({ type: 'ui', what: 'motion', value: 'reduced' })).toEqual(['keeping-it-calm']);
    expect(one({ type: 'ui', what: 'motion', value: 'full' })).toEqual([]);
    expect(one({ type: 'ui', what: 'perf', value: 'lite' })).toEqual(['keeping-it-calm']);
    expect(one({ type: 'ambient.seconds', seconds: 599 })).toEqual([]);
    expect(one({ type: 'ambient.seconds', seconds: 600 })).toEqual(['night-shift']);
    expect(one({ type: 'late' })).toEqual(['running-late']);
    expect(one({ type: 'reconnected' })).toEqual(['reconnected']);
    expect(one({ type: 'cut' })).toEqual(['before-and-after']);
    expect(one({ type: 'egg' })).toEqual(['easter-egg']);
  });
});

describe('stored state', () => {
  it('reads what was saved and drops what it does not know', () => {
    const raw = JSON.stringify({
      v: 1,
      unlocked: { 'first-contact': 1000, 'not-real': 5, 'hello-node': 'x' },
      progress: { continents: ['Asia', 4], paletteKeys: 3.9, commands: -2 },
    });
    const d = parseAchievements(raw);
    expect(d.unlocked).toEqual({ 'first-contact': 1000 });
    expect(d.progress).toMatchObject({ continents: ['Asia'], paletteKeys: 3, commands: 0, blocks: 0 });
  });

  it('survives garbage and missing storage', () => {
    expect(parseAchievements('{nope')).toEqual({ unlocked: {}, progress: EMPTY.progress });
    expect(parseAchievements(null).unlocked).toEqual({});
    expect(parseAchievements('[]').unlocked).toEqual({});
  });
});
