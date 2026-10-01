import { describe, expect, it } from 'vitest';
import type { Toast } from '../../app/toasts';
import { type Entry, type Life, reconcile, removeEntry, roleOf, segments, tick } from './toaststack';

let n = 0;
const make = (over: Partial<Toast> = {}): Toast => ({
  id: ++n,
  kind: 'info',
  title: `toast ${n}`,
  ttlMs: 5000,
  createdMs: 1000,
  ...over,
});
const ids = (e: readonly Entry[]) => e.map((x) => x.toast.id);

describe('reconcile', () => {
  it('shows the oldest toasts up to the limit and holds the rest', () => {
    const t = [make(), make(), make(), make(), make()];
    const e = reconcile([], t, 3);
    expect(ids(e)).toEqual(t.slice(0, 3).map((x) => x.id));
    expect(e.every((x) => !x.leaving)).toBe(true);
  });

  it('keeps a dismissed toast in place while it fades, then promotes the next one', () => {
    const t = [make(), make(), make(), make()];
    const first = reconcile([], t, 3);
    const gone = t[0];
    if (!gone) throw new Error('missing');
    const after = reconcile(first, t.slice(1), 3);
    // The fading toast still holds its place, so the waiting one has no room yet.
    expect(ids(after)).toEqual(ids(first));
    expect(after[0]?.leaving).toBe(true);
    const settled = reconcile(removeEntry(after, gone.id), t.slice(1), 3);
    expect(ids(settled)).toEqual(t.slice(1).map((x) => x.id));
    expect(settled.every((x) => !x.leaving)).toBe(true);
  });

  it('takes the latest content of a refreshed toast', () => {
    const a = make({ key: 'k' });
    const first = reconcile([], [a], 3);
    const refreshed: Toast = { ...a, title: 'new', createdMs: 9000 };
    const next = reconcile(first, [refreshed], 3);
    expect(next[0]?.toast.title).toBe('new');
    expect(next).toHaveLength(1);
  });

  it('shows one at a time on a phone', () => {
    const t = [make(), make()];
    expect(reconcile([], t, 1)).toHaveLength(1);
  });
});

describe('tick', () => {
  const run = (entries: Entry[], lives: Map<number, Life>, dt: number, paused = false) =>
    tick(lives, entries, dt, paused);

  it('expires a toast after its lifetime and not before', () => {
    const t = make({ ttlMs: 5000 });
    const e = reconcile([], [t], 3);
    const lives = new Map<number, Life>();
    expect(run(e, lives, 4900)).toEqual([]);
    expect(run(e, lives, 99)).toEqual([]);
    expect(run(e, lives, 2)).toEqual([t.id]);
  });

  it('does not run while paused', () => {
    const t = make({ ttlMs: 1000 });
    const e = reconcile([], [t], 3);
    const lives = new Map<number, Life>();
    expect(run(e, lives, 5000, true)).toEqual([]);
    expect(lives.get(t.id)?.left).toBe(1000);
    expect(run(e, lives, 1000)).toEqual([t.id]);
  });

  it('never expires a toast with no lifetime', () => {
    const t = make({ ttlMs: 0 });
    const e = reconcile([], [t], 3);
    const lives = new Map<number, Life>();
    expect(run(e, lives, 60_000)).toEqual([]);
  });

  it('starts the clock when a waiting toast comes on screen, not before', () => {
    const t = [make({ ttlMs: 1000 }), make({ ttlMs: 1000 })];
    const e = reconcile([], t, 1);
    const lives = new Map<number, Life>();
    expect(run(e, lives, 1000)).toEqual([t[0]?.id]);
    expect(lives.has(t[1]?.id ?? -1)).toBe(false);
  });

  it('gives a refreshed toast a fresh clock', () => {
    const a = make({ ttlMs: 1000, createdMs: 1000 });
    const lives = new Map<number, Life>();
    const first = reconcile([], [a], 3);
    expect(run(first, lives, 900)).toEqual([]);
    const refreshed: Toast = { ...a, createdMs: 2000 };
    const second = reconcile(first, [refreshed], 3);
    expect(run(second, lives, 900)).toEqual([]);
    expect(lives.get(a.id)?.left).toBe(1000 - 900);
  });

  it('forgets the clock of a toast that left', () => {
    const a = make();
    const lives = new Map<number, Life>();
    const e = reconcile([], [a], 3);
    run(e, lives, 100);
    run(reconcile(e, [], 3), lives, 100);
    expect(lives.size).toBe(0);
  });
});

describe('segments', () => {
  it('sets addresses and long hashes in mono and leaves the prose alone', () => {
    expect(segments('Watched node 65.109.26.93:16147, block 2,996,930.')).toEqual([
      { text: 'Watched node ', mono: false },
      { text: '65.109.26.93:16147', mono: true },
      { text: ', block 2,996,930.', mono: false },
    ]);
    expect(segments('plain')).toEqual([{ text: 'plain', mono: false }]);
    expect(segments('')).toEqual([]);
  });
});

describe('roleOf', () => {
  it('interrupts only for errors', () => {
    expect(roleOf('error')).toBe('alert');
    for (const k of ['info', 'success', 'warning', 'achievement', 'watch'] as const) {
      expect(roleOf(k)).toBe('status');
    }
  });
});
