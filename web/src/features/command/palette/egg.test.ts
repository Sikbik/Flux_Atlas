import { describe, expect, it } from 'vitest';
import type { MoonFlareCmd } from '../../../choreo/effects';
import { GM_LEAD_MS, GM_PIECES, GM_STEP_MS, gmRow, isGm, playGm } from './egg';

function recorder() {
  const calls: { cmd: MoonFlareCmd }[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  return {
    calls,
    effects: { moonFlare: (cmd: MoonFlareCmd) => calls.push({ cmd }) },
    later: (fn: () => void, ms: number) => {
      timers.push({ fn, ms });
    },
    // Runs the timers in time order, the way a clock would.
    run: () => {
      for (const t of [...timers].sort((x, y) => x.ms - y.ms)) t.fn();
    },
  };
}

describe('isGm', () => {
  it('is the greeting and only the greeting', () => {
    expect(isGm('gm')).toBe(true);
    expect(isGm('  GM ')).toBe(true);
    expect(isGm('gmx')).toBe(false);
    expect(isGm('g m')).toBe(false);
    expect(isGm('')).toBe(false);
  });
});

describe('the row', () => {
  it('runs the egg action, is not saved under Recent, and says what it is', () => {
    const r = gmRow();
    expect(r.action).toEqual({ type: 'run', id: 'egg.gm' });
    expect(r.remember).toBeUndefined();
    expect(r.kind).toBe('egg');
  });
});

describe('playGm', () => {
  it('flashes the four pieces in coinbase order, one step apart, after a lead', () => {
    const r = recorder();
    playGm(r.effects, 2_997_000, 'full', r.later);
    r.run();
    expect(r.calls.map((c) => c.cmd.piece)).toEqual([...GM_PIECES]);
    expect(GM_PIECES).toEqual(['bar', 'smallHex', 'bigHex', 'cap']);
    expect(r.calls.every((c) => c.cmd.height === 2_997_000)).toBe(true);
  });

  it('never asks for a whole-moon flare, which would leave a bead for a block that did not land', () => {
    const r = recorder();
    playGm(r.effects, 1, 'full', r.later);
    r.run();
    expect(r.calls.every((c) => c.cmd.piece !== undefined && c.cmd.piece !== 'all')).toBe(true);
  });

  it('times the pieces from the lead by the step', () => {
    const times: number[] = [];
    playGm({ moonFlare: () => {} }, 1, 'full', (_fn, ms) => times.push(ms));
    expect(times).toEqual(GM_PIECES.map((_, i) => GM_LEAD_MS + i * GM_STEP_MS));
  });

  it('is one flash under reduced motion and nothing with motion off', () => {
    const reduced = recorder();
    playGm(reduced.effects, 1, 'reduced', reduced.later);
    reduced.run();
    expect(reduced.calls.map((c) => c.cmd.piece)).toEqual(['cap']);

    const off = recorder();
    playGm(off.effects, 1, 'off', off.later);
    off.run();
    expect(off.calls).toEqual([]);
  });

  it('does nothing without a sink (the globe is not running)', () => {
    expect(() => playGm(undefined, 1, 'full')).not.toThrow();
  });
});
