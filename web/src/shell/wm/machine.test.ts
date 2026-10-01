import { describe, expect, it } from 'vitest';
import {
  dockedWindow,
  globeInset,
  initialWmState,
  minimizedWindows,
  planetMinWidth,
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

describe("the planet's minimum width", () => {
  it('is about 328 px on a 1600 by 900 screen and follows the height', () => {
    expect(planetMinWidth(1600, 900)).toBeCloseTo(328, 0);
    expect(planetMinWidth(3200, 1800)).toBeCloseTo(2 * planetMinWidth(1600, 900), 3);
    expect(planetMinWidth(1100, 700)).toBeLessThan(planetMinWidth(1600, 900));
  });
});

describe('globe inset policy for floating windows', () => {
  const about = { type: 'about', key: null } as const;
  const explorer = { type: 'block', key: '1' } as const;

  it("keeps a floating explorer's side while the planet still fits beside it", () => {
    const s = run(start(), route(explorer));
    expect(globeInset(s).left).toBe(118 + 820 + 24);
  });

  it('lets a floating window float over the globe when it would squeeze the planet out', () => {
    // About docked at the right reserves 464 + 24; the explorer would leave 1600 - 962 - 488 = 150 px, under
    // the planet's 328, so it does not count and the planet frames in what About leaves.
    const s = run(start(), route(explorer, [about]));
    expect(s.windows['about:']!.placement).toBe('docked');
    expect(globeInset(s)).toEqual({ left: 0, right: 464 + 24, top: 52, bottom: 132 });
  });

  it('counts the same window once it is narrow enough to leave the planet its room', () => {
    let s = run(start(), route(explorer, [about]));
    s = run(s, { t: 'nudge', id: 'block:1', dx: 0, dy: 0, dw: -400, dh: 0 });
    expect(s.windows['block:1']!.rect.w).toBe(420);
    // 1600 - (118 + 420 + 24) - 488 = 550, over 328.
    expect(globeInset(s).left).toBe(118 + 420 + 24);
  });

  it('stops counting windows from the widest down, never the nearest first', () => {
    // 1500 wide: the queue (820 from x 118) leaves 538 and counts; analytics (1112) would leave 246, under the
    // planet's 328, so it floats over the globe and the queue's edge is the one that counts.
    let s = start();
    s = run(s, {
      t: 'setViewport',
      viewport: { w: 1500, h: 900 },
      workspace: { x: 0, y: 52, w: 1500, h: 716 },
    });
    s = run(s, open('queue'));
    s = run(s, open('analytics'));
    const queue = s.windows['queue:']!.rect;
    const analytics = s.windows['analytics:']!.rect;
    expect(analytics.x + analytics.w + 24).toBeGreaterThan(1500 - planetMinWidth(1500, 900));
    expect(globeInset(s).left).toBe(queue.x + queue.w + 24);
  });

  it('always reserves a docked window, even when the planet no longer fits beside it', () => {
    // 720 wide: the app inspector reserves 452 + 24 and leaves 244, under the planet's minimum there.
    let s = start();
    s = run(s, {
      t: 'setViewport',
      viewport: { w: 720, h: 900 },
      workspace: { x: 0, y: 52, w: 720, h: 716 },
    });
    s = run(s, route({ type: 'app', key: 'Fluxtracker' }));
    expect(s.layout).toBe('desktop');
    expect(720 - globeInset(s).right).toBeLessThan(planetMinWidth(720, 900));
    expect(globeInset(s).right).toBe(452 + 24);
  });

  it('reserves nothing for a maximized window: the planet stays framed behind it', () => {
    let s = run(start(), route(explorer));
    s = run(s, { t: 'maximize', id: 'block:1' });
    expect(globeInset(s).left).toBe(0);
  });
});

describe('globe inset for a page panel', () => {
  const about = { type: 'about', key: null } as const;
  const explorer = { type: 'block', key: '1' } as const;

  it('shifts the globe right of the panel by its edge and the gap, as for a left-floating window', () => {
    expect(globeInset(start(), 800)).toEqual({ left: 800 + 24, right: 0, top: 52, bottom: 132 });
    // The explorer's own right edge is 118 + 820 = 938: the same edge gives the same inset.
    const w = run(start(), route(explorer));
    const rect = w.windows['block:1']!.rect;
    expect(globeInset(start(), rect.x + rect.w)).toEqual(globeInset(w));
  });

  it('reserves nothing when there is no panel', () => {
    expect(globeInset(start(), 0)).toEqual(globeInset(start()));
  });

  it('lets the panel stand over the globe when it would squeeze the planet out', () => {
    // 1600 wide: a panel ending at 1400 leaves 1600 - 1424 = 176 px, under the planet's 328.
    expect(1600 - (1400 + 24)).toBeLessThan(planetMinWidth(1600, 900));
    expect(globeInset(start(), 1400).left).toBe(0);
  });

  it('counts it up to the edge that leaves the planet its room, and not a pixel past', () => {
    const room = planetMinWidth(1600, 900);
    const fits = Math.floor(1600 - room - 24);
    expect(globeInset(start(), fits).left).toBe(fits + 24);
    expect(globeInset(start(), fits + 2).left).toBe(0);
  });

  it('goes by the same rule as the windows beside it: the largest edge that still leaves the room wins', () => {
    // The explorer ends at 938 (+ 24 = 962). A panel ending further right counts while the planet fits; one that
    // does not fit leaves the explorer's edge in force.
    const w = run(start(), route(explorer));
    expect(globeInset(w, 1000).left).toBe(1000 + 24);
    expect(globeInset(w, 1400).left).toBe(938 + 24);
    // A panel ending short of the explorer changes nothing.
    expect(globeInset(w, 500).left).toBe(938 + 24);
  });

  it('keeps the docked inspector on the right in the fit', () => {
    // About docked at the right reserves 464 + 24: a panel ending at 800 leaves 1600 - 824 - 488 = 288, under 328.
    const s = run(start(), route(null, [about]));
    expect(globeInset(s).right).toBe(464 + 24);
    expect(globeInset(s, 800).left).toBe(0);
    // A narrower panel ending at 700 leaves 1600 - 724 - 488 = 388 and counts.
    expect(globeInset(s, 700).left).toBe(724);
  });

  it('is the page itself on the phone: no inset beside it', () => {
    let s = start();
    s = run(s, {
      t: 'setViewport',
      viewport: { w: 390, h: 844 },
      workspace: { x: 0, y: 190, w: 390, h: 590 },
    });
    expect(s.layout).toBe('phone');
    expect(globeInset(s, 300).left).toBe(0);
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
