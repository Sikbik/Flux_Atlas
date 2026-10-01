import { describe, expect, it, vi } from 'vitest';
import { Budget, type FxKind } from './budget';

function clock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('Budget', () => {
  it('grants leases and frees them on release (idempotent)', () => {
    const b = new Budget();
    const a = b.acquire('pulse', 'a');
    expect(a).not.toBeNull();
    expect(a!.live).toBe(true);
    expect(b.stats().active).toBe(1);
    a!.release();
    a!.release();
    expect(a!.live).toBe(false);
    expect(b.stats().active).toBe(0);
  });

  it('replaces, never stacks, on the same target', () => {
    const b = new Budget();
    const onPreempt = vi.fn();
    const first = b.acquire('pulse', 'btn', onPreempt)!;
    const second = b.acquire('pulse', 'btn')!;
    expect(onPreempt).toHaveBeenCalledTimes(1);
    expect(first.live).toBe(false);
    expect(second.live).toBe(true);
    expect(b.stats().active).toBe(1);
    // Releasing the replaced lease must not free the new one.
    first.release();
    expect(second.live).toBe(true);
  });

  it('does not call onPreempt when a holder releases normally', () => {
    const b = new Budget();
    const onPreempt = vi.fn();
    b.acquire('current', 'x', onPreempt)!.release();
    expect(onPreempt).not.toHaveBeenCalled();
  });

  it('caps each kind', () => {
    const b = new Budget({ flashMax: 99 });
    const got = Array.from({ length: 5 }, (_, i) => b.acquire('pulse', `p${i}`));
    expect(got.filter(Boolean)).toHaveLength(3);
    expect(b.stats().dropped).toBe(2);
    const currents = Array.from({ length: 4 }, (_, i) => b.acquire('current', `c${i}`));
    expect(currents.filter(Boolean)).toHaveLength(2);
    const powers = Array.from({ length: 4 }, (_, i) => b.acquire('power', `w${i}`));
    expect(powers.filter(Boolean)).toHaveLength(2);
  });

  it('caps the total, and a user effect cannot exceed it when only user effects fill it', () => {
    const b = new Budget({ flashMax: 99 });
    const user: FxKind[] = ['pulse', 'pulse', 'pulse', 'spark', 'spark', 'spark', 'slide', 'slide', 'slide'];
    const leases = user.map((k, i) => b.acquire(k, `u${i}`));
    expect(leases.every(Boolean)).toBe(true);
    expect(b.stats().active).toBe(9);
    expect(b.acquire('power', 'w1')).not.toBeNull(); // the tenth
    expect(b.acquire('power', 'w2')).toBeNull(); // the eleventh: no live effect to preempt
    expect(b.stats().active).toBe(10);
  });

  it('limits flashes to three per rolling second, whatever the element', () => {
    const c = clock();
    const b = new Budget({ now: c.now });
    expect(b.acquire('pulse', 'a')).not.toBeNull();
    c.advance(100);
    expect(b.acquire('spark', 'b')).not.toBeNull();
    c.advance(100);
    expect(b.acquire('pulse', 'c')).not.toBeNull();
    c.advance(100);
    expect(b.acquire('pulse', 'd')).toBeNull();
    // The refused flash left the existing ones alone.
    expect(b.stats().active).toBe(3);
    c.advance(701); // the first one leaves the window
    expect(b.acquire('pulse', 'd')).not.toBeNull();
  });

  it('does not touch the existing effect when a flash is refused by the rate limit', () => {
    const c = clock();
    const b = new Budget({ now: c.now, flashMax: 1 });
    const onPreempt = vi.fn();
    const first = b.acquire('pulse', 'btn', onPreempt)!;
    expect(b.acquire('pulse', 'btn')).toBeNull();
    expect(onPreempt).not.toHaveBeenCalled();
    expect(first.live).toBe(true);
  });

  it('live effects do not count against the flash rate', () => {
    const b = new Budget({ caps: { current: 8 } });
    for (let i = 0; i < 8; i++) expect(b.acquire('current', `s${i}`)).not.toBeNull();
  });

  it('user effects preempt the oldest live effect when the room is full', () => {
    const c = clock();
    const b = new Budget({ now: c.now, flashMax: 99, caps: { current: 10 } });
    const preempts: string[] = [];
    for (let i = 0; i < 10; i++) {
      c.advance(10);
      b.acquire('current', `c${i}`, () => preempts.push(`c${i}`));
    }
    expect(b.stats().active).toBe(10);
    // A live effect finds the room full and is dropped.
    expect(b.acquire('current', 'late')).toBeNull();
    // A user effect preempts the oldest live one.
    const p = b.acquire('pulse', 'press');
    expect(p).not.toBeNull();
    expect(preempts).toEqual(['c0']);
    expect(b.stats().active).toBe(10);
  });

  it('refuses a user effect when the room is full of user effects', () => {
    const b = new Budget({ total: 2, flashMax: 99 });
    expect(b.acquire('pulse', 'a')).not.toBeNull();
    expect(b.acquire('spark', 'b')).not.toBeNull();
    expect(b.acquire('power', 'c')).toBeNull();
  });

  it('counts granted, dropped and preempted, per kind', () => {
    const b = new Budget({ flashMax: 99 });
    b.acquire('pulse', 'a');
    b.acquire('pulse', 'a'); // replaces
    b.acquire('current', 'x');
    const s = b.stats();
    expect(s.granted).toBe(3);
    expect(s.preempted).toBe(1);
    expect(s.byKind.pulse).toBe(1);
    expect(s.byKind.current).toBe(1);
    expect(s.dropped).toBe(0);
  });

  it('never stacks: any burst ends with at most one lease per key and the totals respected', () => {
    const c = clock();
    const b = new Budget({ now: c.now });
    const kinds: FxKind[] = ['pulse', 'spark', 'slide', 'power', 'current'];
    for (let i = 0; i < 400; i++) {
      c.advance(i % 7 === 0 ? 400 : 5);
      b.acquire(kinds[i % kinds.length]!, `k${i % 13}`);
      const s = b.stats();
      expect(s.active).toBeLessThanOrEqual(10);
      expect(s.byKind.pulse).toBeLessThanOrEqual(3);
      expect(s.byKind.spark).toBeLessThanOrEqual(3);
      expect(s.byKind.current).toBeLessThanOrEqual(2);
      expect(s.byKind.power).toBeLessThanOrEqual(2);
    }
  });

  it('disposes: every holder is told to stop and nothing stays alive', () => {
    const b = new Budget();
    const stops: number[] = [];
    const leases = [1, 2].map((n) => b.acquire('current', `k${n}`, () => stops.push(n))!);
    b.dispose();
    expect(stops.sort()).toEqual([1, 2]);
    expect(leases.every((l) => !l.live)).toBe(true);
    expect(b.stats().active).toBe(0);
  });
});
