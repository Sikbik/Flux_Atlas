import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatInt } from '../../lib/format';
import {
  initialView,
  OdometerController,
  type OdometerHost,
  type OdometerOptions,
  type OdometerView,
  startsFromZero,
} from './useOdometer';

const baseOptions: OdometerOptions = {
  format: formatInt,
  roll: true,
  tint: true,
  maxHz: 1,
  countUpOnMount: false,
  mode: 'full',
};

interface Rig {
  ctl: OdometerController;
  views: OdometerView[];
  view(): OdometerView;
  options: OdometerOptions;
}

function rig(initial: number | null, over: Partial<OdometerOptions> = {}): Rig {
  const options = { ...baseOptions, ...over };
  let view = initialView(initial, options);
  const views: OdometerView[] = [view];
  const host: OdometerHost = {
    options: () => options,
    set: (fn) => {
      const next = fn(view);
      if (next !== view) {
        view = next;
        views.push(next);
      }
    },
  };
  return { ctl: new OdometerController(host, initial), views, view: () => view, options };
}

// A manual frame loop, so count-ups can be stepped deterministically.
let frames: Array<(ts: number) => void> = [];
function runFrame(ts: number) {
  const cbs = frames;
  frames = [];
  for (const cb of cbs) cb(ts);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: (ts: number) => void) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {
    frames = [];
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('OdometerController', () => {
  it('draws the first value without animation', () => {
    const r = rig(6724);
    expect(r.view()).toMatchObject({ target: 6724, frame: null, plan: null, tint: null, seq: 0 });
    r.ctl.push(6724);
    expect(r.views).toHaveLength(1);
  });

  it('rolls a +1 and tints up', () => {
    const r = rig(6724);
    r.ctl.push(6725);
    const v = r.view();
    expect(v.target).toBe(6725);
    expect(v.dir).toBe('up');
    expect(v.tint).toBe('up');
    expect(v.plan?.text).toBe('6,725');
    expect(v.plan?.cells.filter((c) => c.changed)).toHaveLength(1);
    expect(v.seq).toBe(1);
  });

  it('rolls down and tints down when the value falls', () => {
    const r = rig(6724);
    r.ctl.push(6723);
    expect(r.view()).toMatchObject({ dir: 'down', tint: 'down' });
  });

  it('shows Unknown instantly and a number after it without a tint', () => {
    const r = rig(6724);
    r.ctl.push(null);
    expect(r.view()).toMatchObject({ target: null, tint: null, plan: null });
    vi.advanceTimersByTime(1000);
    r.ctl.push(10);
    expect(r.view()).toMatchObject({ target: 10, tint: null, plan: null });
  });

  it('limits visual updates to maxHz and shows the latest value last', () => {
    const r = rig(100, { maxHz: 1 });
    r.ctl.push(101); // the first update shows at once
    expect(r.view().target).toBe(101);
    const after = r.views.length;
    vi.advanceTimersByTime(200);
    r.ctl.push(102);
    vi.advanceTimersByTime(200);
    r.ctl.push(103);
    vi.advanceTimersByTime(200);
    r.ctl.push(104);
    expect(r.views).toHaveLength(after); // nothing visible yet
    vi.advanceTimersByTime(399);
    expect(r.view().target).toBe(101);
    vi.advanceTimersByTime(1);
    expect(r.view().target).toBe(104);
    expect(r.views).toHaveLength(after + 1); // exactly one more visual update
  });

  it('arms at most one timeout however fast values arrive', () => {
    const r = rig(1);
    r.ctl.push(2);
    for (let i = 3; i < 200; i++) r.ctl.push(i);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('skips a pending update when the value returns to what is shown', () => {
    const r = rig(100);
    r.ctl.push(101);
    const n = r.views.length;
    vi.advanceTimersByTime(100);
    r.ctl.push(102);
    r.ctl.push(101);
    vi.advanceTimersByTime(2000);
    expect(r.views).toHaveLength(n);
  });

  it('shows every update when coalescing is off', () => {
    const r = rig(100, { maxHz: 0 });
    r.ctl.push(101);
    r.ctl.push(102);
    r.ctl.push(103);
    expect(r.view().target).toBe(103);
    expect(r.views).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('swaps without rolling for roll={false}, with no tint unless asked', () => {
    const r = rig(5, { roll: false, tint: false });
    r.ctl.push(6);
    expect(r.view()).toMatchObject({ target: 6, plan: null, dir: null, tint: null });
  });

  it('under reduced motion swaps and tints; under off it swaps with no tint', () => {
    const reduced = rig(6724, { mode: 'reduced' });
    reduced.ctl.push(6725);
    expect(reduced.view()).toMatchObject({ target: 6725, plan: null, dir: null, tint: 'up' });
    const off = rig(6724, { mode: 'off' });
    off.ctl.push(6725);
    expect(off.view()).toMatchObject({ target: 6725, plan: null, dir: null, tint: null });
  });

  it('swaps a tiny change of a measured quantity silently', () => {
    const fmt = (n: number) => n.toFixed(2);
    const r = rig(62193420.55, { format: fmt });
    r.ctl.push(62193420.56);
    expect(r.view()).toMatchObject({ target: 62193420.56, plan: null, tint: null });
  });

  it('does not roll, tint or restart anything when the text does not change', () => {
    const fmt = (n: number) => `${Math.round(n)}`;
    const r = rig(10, { format: fmt });
    r.ctl.push(10.2);
    expect(r.view()).toMatchObject({ plan: null, tint: null, frame: null, seq: 0 });
  });
});

describe('count-up', () => {
  it('counts a big jump from the previous value over 900 ms and settles on the target', () => {
    const r = rig(1000);
    r.ctl.push(2000);
    expect(r.view()).toMatchObject({ target: 2000, frame: '1,000', tint: 'up', dir: 'up' });
    runFrame(0);
    const early = r.view().frame;
    expect(early).toBe('1,000');
    runFrame(100);
    const mid = Number((r.view().frame ?? '0').replace(/,/g, ''));
    expect(mid).toBeGreaterThan(1500);
    expect(mid).toBeLessThan(2000);
    runFrame(500);
    runFrame(900);
    expect(r.view().frame).toBeNull();
    expect(r.view().target).toBe(2000);
    expect(frames).toHaveLength(0);
  });

  it('counts up from zero on mount when asked, and only for the first number', () => {
    const opts = { ...baseOptions, countUpOnMount: true };
    expect(startsFromZero(6725, opts)).toBe(true);
    expect(startsFromZero(null, opts)).toBe(false);
    expect(startsFromZero(6725, { ...opts, mode: 'reduced' })).toBe(false);
    const r = rig(6725, { countUpOnMount: true });
    expect(r.view().frame).toBe('0');
    r.ctl.push(6725); // the mount effect
    runFrame(0);
    runFrame(450);
    expect(Number((r.view().frame ?? '0').replace(/,/g, ''))).toBeGreaterThan(6000);
    runFrame(900);
    expect(r.view()).toMatchObject({ target: 6725, frame: null });
    // A later small change rolls: it is no longer the first number.
    vi.advanceTimersByTime(2000);
    r.ctl.push(6726);
    expect(r.view().plan?.text).toBe('6,726');
  });

  it('a new value during a count-up continues from where it is', () => {
    const r = rig(1000, { maxHz: 0 });
    r.ctl.push(5000);
    runFrame(0);
    runFrame(60);
    const shownNow = Number((r.view().frame ?? '0').replace(/,/g, ''));
    expect(shownNow).toBeGreaterThan(1000);
    r.ctl.push(9000);
    expect(r.view().target).toBe(9000);
    expect(Number((r.view().frame ?? '0').replace(/,/g, ''))).toBeGreaterThanOrEqual(shownNow - 1);
  });

  it('dispose rewinds a running count so a remount plays it again (strict mode)', () => {
    const r = rig(6725, { countUpOnMount: true });
    r.ctl.push(6725);
    runFrame(0);
    runFrame(300);
    r.ctl.dispose();
    r.ctl.push(6725); // the re-run of the mount effect
    expect(r.view().frame).toBe('0');
    runFrame(1000);
    runFrame(1900);
    expect(r.view()).toMatchObject({ target: 6725, frame: null });
  });

  it('dispose clears a pending timeout', () => {
    const r = rig(1);
    r.ctl.push(2);
    r.ctl.push(3);
    expect(vi.getTimerCount()).toBe(1);
    r.ctl.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
