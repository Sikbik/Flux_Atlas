import { describe, expect, it } from 'vitest';
import {
  dockedWindow,
  globeInset,
  initialWmState,
  minimizedWindows,
  snapPreview,
  topmost,
  visibleWindows,
  windowOfType,
  windowRect,
  wmReduce,
} from './machine';
import type { WindowRef, WmAction, WmState } from './types';

const V = { w: 1600, h: 900 };
// Default workspace: below the 52 px top bar, above the 104 px rail and 28 px status bar.
const WS = { x: 0, y: 52, w: 1600, h: 716 };

function run(s: WmState, ...actions: WmAction[]): WmState {
  return actions.reduce(wmReduce, s);
}
const start = () => initialWmState(V, WS);
let clock = 0;
const route = (primary: WindowRef | null, extras: WindowRef[] = []): WmAction => ({
  t: 'syncRoute',
  primary,
  extras,
  now: ++clock,
});
const open = (type: WindowRef['type'], key: string | null = null): WmAction => ({
  t: 'open',
  type,
  key,
  now: ++clock,
});
const ids = (s: WmState) => s.order.slice();

describe('route binding', () => {
  it('opens the primary window from the route, docked, focused and on top', () => {
    const s = run(start(), route({ type: 'node', key: '1.2.3.4:16127' }));
    const w = windowOfType(s, 'node')!;
    expect(w).toMatchObject({
      id: 'node:1.2.3.4:16127',
      placement: 'docked',
      binding: 'primary',
      mode: 'normal',
    });
    expect(s.focused).toBe(w.id);
    expect(windowRect(s, w.id)).toEqual({ x: 1180, y: 52, w: 420, h: 716 });
  });

  it('retargets node to node in place: same window id, new key, title and tether', () => {
    let s = run(start(), route({ type: 'node', key: '7' }));
    const id = s.focused!;
    expect(s.windows[id]!.tether).toEqual({ kind: 'node', id: 7 });
    s = run(s, route({ type: 'node', key: '9' }));
    expect(ids(s)).toEqual([id]);
    expect(s.windows[id]).toMatchObject({ key: '9', title: 'Node 9', tether: { kind: 'node', id: 9 } });
  });

  it('closes route-bound windows that left the URL and keeps free ones', () => {
    let s = run(start(), open('settings'), route({ type: 'app', key: 'x' }, [{ type: 'queue', key: null }]));
    expect(Object.keys(s.windows).sort()).toEqual(['app:x', 'queue:', 'settings:']);
    s = run(s, route(null));
    expect(Object.keys(s.windows)).toEqual(['settings:']);
    expect(s.focused).toBe('settings:');
  });

  it('opens extras without stealing focus from the primary', () => {
    const s = run(start(), route({ type: 'block', key: '5' }, [{ type: 'queue', key: null }]));
    expect(windowOfType(s, 'queue')!.binding).toBe('extra');
    expect(s.focused).toBe('block:5');
    expect(topmost(s)!.id).toBe('block:5');
  });

  it('demotes the old primary to an extra when it moves into ?w=', () => {
    let s = run(start(), route({ type: 'queue', key: null }));
    s = run(s, route({ type: 'block', key: '1' }, [{ type: 'queue', key: null }]));
    expect(windowOfType(s, 'queue')!.binding).toBe('extra');
    expect(windowOfType(s, 'block')!.binding).toBe('primary');
  });

  it('is a no-op (same state object) when the route did not change', () => {
    const s = run(start(), route({ type: 'node', key: '7' }));
    expect(wmReduce(s, route({ type: 'node', key: '7' }))).toBe(s);
  });

  it('does not re-raise the primary on an unchanged route after the user focused another window', () => {
    let s = run(start(), route({ type: 'block', key: '1' }, [{ type: 'queue', key: null }]));
    s = run(s, { t: 'focus', id: 'queue:' });
    s = run(s, route({ type: 'block', key: '1' }, [{ type: 'queue', key: null }]));
    expect(s.focused).toBe('queue:');
  });

  it('tracks the time strip and the weather layer but never frames them', () => {
    const s = run(start(), route({ type: 'time', key: null }));
    expect(windowOfType(s, 'time')).not.toBeNull();
    expect(visibleWindows(s)).toEqual([]);
    expect(s.focused).toBeNull();
  });
});

describe('docking and floating limits', () => {
  it('keeps one docked window: a primary in the slot closes, a free one floats', () => {
    let s = run(start(), route({ type: 'node', key: '1' }), open('about'));
    expect(windowOfType(s, 'node')).toBeNull();
    expect(dockedWindow(s)!.type).toBe('about');
    s = run(s, open('app', 'x'));
    expect(dockedWindow(s)!.type).toBe('app');
    expect(windowOfType(s, 'about')!.placement).toBe('floating');
  });

  it('an extra that wants the dock floats instead of evicting the primary', () => {
    const s = run(start(), route({ type: 'node', key: '1' }, [{ type: 'app', key: 'x' }]));
    expect(dockedWindow(s)!.type).toBe('node');
    expect(windowOfType(s, 'app')!.placement).toBe('floating');
  });

  it('allows at most two floating windows, closing the oldest non-primary one', () => {
    let s = run(start(), route({ type: 'block', key: '1' }), open('settings'), open('terminal'));
    expect(Object.keys(s.windows).sort()).toEqual(['block:1', 'terminal:']);
    s = run(s, open('mempool'));
    expect(windowOfType(s, 'block')).not.toBeNull();
    expect(Object.keys(s.windows).sort()).toEqual(['block:1', 'mempool:']);
  });

  it('toggles dock and float, and refuses to dock a non-dockable type', () => {
    let s = run(start(), route({ type: 'node', key: '1' }));
    s = run(s, { t: 'toggleDock', id: 'node:1' });
    expect(s.windows['node:1']!.placement).toBe('floating');
    s = run(s, { t: 'toggleDock', id: 'node:1' });
    expect(s.windows['node:1']!.placement).toBe('docked');
    const t = run(start(), open('terminal'));
    expect(wmReduce(t, { t: 'toggleDock', id: 'terminal:' })).toBe(t);
  });

  it('clamps the docked inspector width to its min and max', () => {
    let s = run(start(), route({ type: 'node', key: '1' }));
    s = run(s, { t: 'resize', id: 'node:1', rect: { x: 0, y: 0, w: 2000, h: 10 } });
    expect(s.windows['node:1']!.dockWidth).toBe(640);
    s = run(s, { t: 'nudge', id: 'node:1', dx: 0, dy: 0, dw: -1000, dh: 0 });
    expect(s.windows['node:1']!.dockWidth).toBe(360);
  });
});

describe('focus and z-order', () => {
  it('focus raises to the top without moving the window', () => {
    let s = run(start(), open('block', '1'), open('settings'));
    const before = s.windows['block:1']!.rect;
    s = run(s, { t: 'focus', id: 'block:1' });
    expect(s.order.at(-1)).toBe('block:1');
    expect(s.focused).toBe('block:1');
    expect(s.windows['block:1']!.rect).toEqual(before);
  });

  it('cycles focus in opening order both ways and skips minimized windows', () => {
    let s = run(start(), route({ type: 'node', key: '1' }), open('block', '2'), open('settings'));
    s = run(s, { t: 'minimize', id: 'block:2' });
    expect(s.focused).toBe('settings:');
    s = run(s, { t: 'cycleFocus', dir: 1 });
    expect(s.focused).toBe('node:1');
    s = run(s, { t: 'cycleFocus', dir: 1 });
    expect(s.focused).toBe('settings:');
    s = run(s, { t: 'cycleFocus', dir: -1 });
    expect(s.focused).toBe('node:1');
    s = run(s, { t: 'cycleFocus', dir: -1 });
    expect(s.focused).toBe('settings:');
  });

  it('closing the focused window focuses the next topmost', () => {
    let s = run(start(), open('block', '1'), open('settings'));
    s = run(s, { t: 'close', id: 'settings:' });
    expect(s.focused).toBe('block:1');
    s = run(s, { t: 'close', id: 'block:1' });
    expect(s.focused).toBeNull();
    expect(s.order).toEqual([]);
  });
});

describe('minimize, maximize, restore', () => {
  it('round trips', () => {
    let s = run(start(), open('block', '1'));
    const rect = s.windows['block:1']!.rect;
    s = run(s, { t: 'maximize', id: 'block:1' });
    expect(windowRect(s, 'block:1')).toEqual(WS);
    s = run(s, { t: 'minimize', id: 'block:1' });
    expect(visibleWindows(s)).toEqual([]);
    expect(minimizedWindows(s).map((w) => w.id)).toEqual(['block:1']);
    expect(s.focused).toBeNull();
    s = run(s, { t: 'restore', id: 'block:1' });
    expect(s.windows['block:1']!.mode).toBe('normal');
    expect(windowRect(s, 'block:1')).toEqual(rect);
    expect(s.focused).toBe('block:1');
  });

  it('focusing a minimized window restores it (the dock dot)', () => {
    let s = run(start(), open('block', '1'), { t: 'minimize', id: 'block:1' });
    s = run(s, { t: 'focus', id: 'block:1' });
    expect(s.windows['block:1']!.mode).toBe('normal');
  });

  it('a route back to a minimized primary restores it', () => {
    let s = run(start(), route({ type: 'block', key: '1' }), { t: 'minimize', id: 'block:1' });
    s = run(s, route({ type: 'block', key: '2' }));
    expect(s.windows['block:1']).toMatchObject({ key: '2', mode: 'normal' });
  });
});

describe('drag, snap, resize, nudge', () => {
  const drag = (
    id: string,
    from: [number, number],
    to: [number, number],
    kind: 'move' | 'resize' = 'move',
    edges = '',
  ) => [
    { t: 'dragStart', id, kind, edges, px: from[0], py: from[1] } as WmAction,
    { t: 'dragMove', px: to[0], py: to[1] } as WmAction,
  ];

  it('moves a floating window and clamps it into the workspace on release', () => {
    let s = run(start(), open('terminal'), ...drag('terminal:', [200, 400], [260, 380]));
    const r0 = s.windows['terminal:']!.rect;
    expect(s.drag!.zone).toBeNull();
    s = run(s, { t: 'dragEnd' });
    expect(s.windows['terminal:']!.rect).toEqual(r0);
    s = run(s, ...drag('terminal:', [200, 400], [200, 2000]), { t: 'dragEnd' });
    const r = s.windows['terminal:']!.rect;
    expect(r.y + r.h).toBeLessThanOrEqual(WS.y + WS.h);
    expect(s.memory.terminal?.rect).toEqual(r);
  });

  it('snaps to the left column within 24 px of the left edge', () => {
    let s = run(start(), open('block', '1'), ...drag('block:1', [400, 100], [10, 300]));
    expect(s.drag!.zone).toBe('left');
    expect(snapPreview(s)).toEqual({ x: 0, y: 52, w: 820, h: 716 });
    s = run(s, { t: 'dragEnd' });
    expect(s.windows['block:1']!.rect).toEqual({ x: 0, y: 52, w: 820, h: 716 });
    expect(s.drag).toBeNull();
  });

  it('snaps a dockable window on the right edge into the dock, a non-dockable one to a right column', () => {
    let s = run(start(), open('app', 'x'), { t: 'toggleDock', id: 'app:x' });
    expect(s.windows['app:x']!.placement).toBe('floating');
    s = run(s, ...drag('app:x', [1400, 100], [1590, 300]));
    expect(snapPreview(s)).toEqual({ x: 1148, y: 52, w: 452, h: 716 });
    s = run(s, { t: 'dragEnd' });
    expect(dockedWindow(s)!.id).toBe('app:x');
    let t = run(start(), open('terminal'), ...drag('terminal:', [300, 500], [1595, 500]), { t: 'dragEnd' });
    expect(t.windows['terminal:']!.rect).toEqual({ x: 840, y: 52, w: 760, h: 716 });
    t = run(t, ...drag('terminal:', [1000, 60], [800, 60]));
    expect(t.drag!.zone).toBe('top');
    t = run(t, { t: 'dragEnd' });
    expect(t.windows['terminal:']!.mode).toBe('maximized');
  });

  it('dragging the docked inspector by its title bar undocks it', () => {
    const s = run(start(), route({ type: 'node', key: '1' }), ...drag('node:1', [1300, 70], [1000, 200]));
    expect(s.windows['node:1']!.placement).toBe('floating');
    expect(s.windows['node:1']!.rect.x).toBe(880);
  });

  it('resizes from edges and corners down to the minimum size', () => {
    let s = run(start(), open('terminal'));
    const r = s.windows['terminal:']!.rect;
    s = run(s, ...drag('terminal:', [r.x + r.w, r.y + r.h], [r.x, r.y], 'resize', 'se'), { t: 'dragEnd' });
    expect(s.windows['terminal:']!.rect).toMatchObject({ x: r.x, y: r.y, w: 320, h: 240 });
    s = run(s, ...drag('terminal:', [r.x, r.y], [r.x - 100, r.y - 50], 'resize', 'nw'), { t: 'dragEnd' });
    expect(s.windows['terminal:']!.rect).toMatchObject({ x: r.x - 100, y: r.y - 50, w: 420, h: 290 });
  });

  it('resizes the docked inspector from its left edge', () => {
    const s = run(
      start(),
      route({ type: 'node', key: '1' }),
      ...drag('node:1', [1180, 300], [1080, 300], 'resize', 'w'),
    );
    expect(s.windows['node:1']!.dockWidth).toBe(520);
  });

  it('nudges with the keyboard, clamped to the workspace', () => {
    let s = run(start(), open('settings'));
    const r = s.windows['settings:']!.rect;
    s = run(s, { t: 'nudge', id: 'settings:', dx: 16, dy: -16, dw: 0, dh: 0 });
    expect(s.windows['settings:']!.rect).toMatchObject({ x: r.x + 16, y: r.y - 16 });
    s = run(s, { t: 'nudge', id: 'settings:', dx: -5000, dy: 0, dw: 0, dh: 0 });
    expect(s.windows['settings:']!.rect.x).toBe(0);
    s = run(s, { t: 'nudge', id: 'settings:', dx: 0, dy: 0, dw: -1000, dh: 0 });
    expect(s.windows['settings:']!.rect.w).toBe(320);
  });
});

describe('viewport and phone', () => {
  it('re-clamps windows when the viewport shrinks', () => {
    let s = run(start(), open('analytics'));
    expect(s.windows['analytics:']!.rect.w).toBe(1112);
    s = run(s, {
      t: 'setViewport',
      viewport: { w: 1000, h: 700 },
      workspace: { x: 0, y: 52, w: 1000, h: 516 },
    });
    const r = s.windows['analytics:']!.rect;
    expect(r.x + r.w).toBeLessThanOrEqual(1000);
    expect(r.y + r.h).toBeLessThanOrEqual(568);
    expect(s.layout).toBe('desktop');
  });

  it('switches to the phone sheet under 720 px and back', () => {
    let s = run(start(), route({ type: 'node', key: '1' }), open('settings'));
    s = run(s, {
      t: 'setViewport',
      viewport: { w: 390, h: 844 },
      workspace: { x: 0, y: 100, w: 390, h: 680 },
    });
    expect(s.layout).toBe('phone');
    expect(visibleWindows(s).map((w) => w.id)).toEqual(['settings:']);
    expect(Object.keys(s.windows).length).toBe(2);
    const half = windowRect(s, 'settings:');
    expect(half.h).toBe(372);
    expect(half.y + half.h).toBe(844 - 64);
    expect(globeInset(s).bottom).toBe(372 + 64);
    s = run(s, { t: 'setSheet', snap: 'full' });
    expect(windowRect(s, 'settings:').h).toBe(844 - 64 - 16);
    s = run(s, { t: 'focus', id: 'node:1' });
    expect(visibleWindows(s).map((w) => w.id)).toEqual(['node:1']);
    s = run(s, { t: 'setViewport', viewport: V, workspace: WS });
    expect(s.layout).toBe('desktop');
    expect(visibleWindows(s).length).toBe(2);
  });
});

describe('globe inset', () => {
  it('is the workspace edges on the bare globe', () => {
    expect(globeInset(start())).toEqual({ left: 0, right: 0, top: 52, bottom: 132 });
  });

  it('reserves the docked inspector plus 24 px on the right', () => {
    const s = run(start(), route({ type: 'node', key: '1' }));
    expect(globeInset(s)).toEqual({ left: 0, right: 444, top: 52, bottom: 132 });
  });

  it('shifts the globe right of a left-floating explorer window', () => {
    const s = run(start(), route({ type: 'block', key: '1' }));
    expect(s.windows['block:1']!.rect).toEqual({ x: 118, y: 66, w: 820, h: 688 });
    expect(globeInset(s).left).toBe(118 + 820 + 24);
  });

  it('ignores minimized and centred windows', () => {
    const s = run(start(), open('settings'), route({ type: 'block', key: '1' }), {
      t: 'minimize',
      id: 'block:1',
    });
    expect(globeInset(s).left).toBe(0);
  });
});

describe('tether and titles', () => {
  it('points About at the moon and lets the bindings set node and cluster anchors', () => {
    let s = run(start(), route({ type: 'about', key: null }));
    expect(s.windows['about:']!.tether).toEqual({ kind: 'moon' });
    s = run(s, route({ type: 'host', key: '1.2.3.4' }));
    expect(s.windows['host:1.2.3.4']!.tether).toBeNull();
    s = run(s, { t: 'setTether', id: 'host:1.2.3.4', tether: { kind: 'cluster', lat: 60, lon: 24 } });
    expect(s.windows['host:1.2.3.4']!.tether).toEqual({ kind: 'cluster', lat: 60, lon: 24 });
    const same = wmReduce(s, {
      t: 'setTether',
      id: 'host:1.2.3.4',
      tether: { kind: 'cluster', lat: 60, lon: 24 },
    });
    expect(same).toBe(s);
    s = run(s, { t: 'setTitle', id: 'host:1.2.3.4', title: 'Host 1.2.3.4, 7 nodes' });
    expect(s.windows['host:1.2.3.4']!.title).toBe('Host 1.2.3.4, 7 nodes');
  });
});

describe('placement memory', () => {
  it('reopens a type where it was last left', () => {
    let s = run(start(), open('terminal'), { t: 'nudge', id: 'terminal:', dx: 100, dy: -100, dw: 0, dh: 0 });
    const r = s.windows['terminal:']!.rect;
    s = run(s, { t: 'close', id: 'terminal:' }, open('terminal'));
    expect(s.windows['terminal:']!.rect).toEqual(r);
  });

  it('remembers that a dockable type was floated', () => {
    let s = run(start(), open('about'), { t: 'toggleDock', id: 'about:' }, { t: 'close', id: 'about:' });
    s = run(s, open('about'));
    expect(s.windows['about:']!.placement).toBe('floating');
  });
});
