import { describe, expect, it } from 'vitest';
import { initialWmState, wmReduce } from '../wm/machine';
import type { WindowRef, WmAction, WmState } from '../wm/types';
import { dockKey, dockState, parseDockKey } from './dock';

const V = { w: 1600, h: 900 };
const WS = { x: 0, y: 52, w: 1600, h: 716 };
let tick = 0;
const run = (s: WmState, ...a: WmAction[]) => a.reduce(wmReduce, s);
const route = (primary: WindowRef | null, extras: WindowRef[] = []): WmAction => ({
  t: 'syncRoute',
  primary,
  extras,
  now: ++tick,
});
const start = () => initialWmState(V, WS);

describe('dockState', () => {
  it('shows the bare globe as focused while no framed window is open', () => {
    const s = start();
    expect(dockState(s, 'globe')).toBe('focus');
    expect(dockState(s, 'nodes')).toBe('idle');
  });

  it('focuses the launcher whose window is focused, and the globe goes idle', () => {
    const s = run(start(), route({ type: 'node', key: '1.2.3.4:16127' }));
    expect(dockState(s, 'nodes')).toBe('focus');
    expect(dockState(s, 'globe')).toBe('idle');
    expect(dockState(s, 'apps')).toBe('idle');
  });

  it('marks a launcher open when its window exists but another is focused', () => {
    const s = run(start(), route({ type: 'queue', key: null }, [{ type: 'node', key: '1.2.3.4:16127' }]));
    // The primary (the queue) is focused; the node window rides along.
    expect(dockState(s, 'queue')).toBe('focus');
    expect(dockState(s, 'nodes')).toBe('open');
  });

  it('marks all-minimized launchers as min', () => {
    let s = run(start(), route({ type: 'node', key: '1.2.3.4:16127' }));
    s = run(s, { t: 'minimize', id: s.focused as string });
    expect(dockState(s, 'nodes')).toBe('min');
    expect(dockState(s, 'globe')).toBe('focus');
  });

  it('groups the explorer window types under one launcher', () => {
    const s = run(start(), route({ type: 'block', key: '100' }));
    expect(dockState(s, 'explorer')).toBe('focus');
    const t = run(start(), route({ type: 'tx', key: 'abc' }));
    expect(dockState(t, 'explorer')).toBe('focus');
  });

  it('treats the time machine (never framed) as the focus while present', () => {
    const s = run(start(), route({ type: 'time', key: null }));
    expect(dockState(s, 'time')).toBe('focus');
  });
});

describe('dockKey', () => {
  it('round-trips through parseDockKey', () => {
    const s = run(start(), route({ type: 'node', key: '1.2.3.4:16127' }));
    const key = dockKey(s, ['globe', 'nodes', 'apps']);
    expect(parseDockKey(key)).toEqual({ globe: 'idle', nodes: 'focus', apps: 'idle' });
  });

  it('is the same string for the same states (so a selector does not re-render)', () => {
    const a = dockKey(start(), ['globe', 'nodes']);
    const b = dockKey(run(start(), { t: 'setViewport', viewport: V, workspace: WS }), ['globe', 'nodes']);
    expect(a).toBe(b);
  });
});
