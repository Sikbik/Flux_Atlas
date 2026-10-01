import { describe, expect, it } from 'vitest';
import { initialWmState, wmReduce } from '../wm/machine';
import type { WindowRef, WmAction, WmState } from '../wm/types';
import { skipElement, skipTarget } from './skip';

const desktop = (): WmState => initialWmState({ w: 1600, h: 900 }, { x: 0, y: 52, w: 1588, h: 716 });
const run = (s: WmState, ...actions: WmAction[]): WmState => actions.reduce(wmReduce, s);
let clock = 0;
const route = (primary: WindowRef | null, extras: WindowRef[] = []): WmAction => ({
  t: 'syncRoute',
  primary,
  extras,
  now: ++clock,
});

describe('where "Skip to content" goes', () => {
  it('is the globe stage when nothing is open', () => {
    expect(skipTarget(desktop(), false)).toEqual({ kind: 'stage' });
  });

  it('is the page panel when one stands in the stage and no window is open', () => {
    expect(skipTarget(desktop(), true)).toEqual({ kind: 'page' });
  });

  it('is the open window, ahead of the page behind it', () => {
    const s = run(desktop(), route({ type: 'block', key: '1' }));
    expect(skipTarget(s, false)).toEqual({ kind: 'window', id: 'block:1' });
    expect(skipTarget(s, true)).toEqual({ kind: 'window', id: 'block:1' });
  });

  it('prefers the focused window, else the topmost', () => {
    let s = run(desktop(), route({ type: 'block', key: '1' }, [{ type: 'about', key: null }]));
    s = run(s, { t: 'focus', id: 'block:1' });
    expect(skipTarget(s, false)).toEqual({ kind: 'window', id: 'block:1' });
    s = run(s, { t: 'focus', id: 'about:' });
    expect(skipTarget(s, false)).toEqual({ kind: 'window', id: 'about:' });
  });

  it('passes over a minimized window', () => {
    let s = run(desktop(), route({ type: 'block', key: '1' }));
    s = run(s, { t: 'minimize', id: 'block:1' });
    expect(skipTarget(s, false)).toEqual({ kind: 'stage' });
    expect(skipTarget(s, true)).toEqual({ kind: 'page' });
  });

  it('is the sheet on a phone, the one window that is shown', () => {
    let s = run(desktop(), route({ type: 'block', key: '1' }, [{ type: 'about', key: null }]));
    s = run(s, {
      t: 'setViewport',
      viewport: { w: 390, h: 844 },
      workspace: { x: 0, y: 158, w: 390, h: 622 },
    });
    expect(s.layout).toBe('phone');
    const target = skipTarget(s, false);
    expect(target.kind).toBe('window');
    expect(target.kind === 'window' && s.focused === target.id).toBe(true);
  });
});

describe('the element it goes to', () => {
  const asked: string[] = [];
  const finder = {
    querySelector: (sel: string) => {
      asked.push(sel);
      return { sel } as unknown as Element;
    },
  };

  it("is a window's body, past its title bar's controls", () => {
    asked.length = 0;
    skipElement(finder, { kind: 'window', id: 'node:abc' });
    expect(asked).toEqual(['[data-window-id="node:abc"] .wm-body']);
  });

  it('is the page slot or the stage', () => {
    asked.length = 0;
    skipElement(finder, { kind: 'page' });
    skipElement(finder, { kind: 'stage' });
    expect(asked).toEqual(['.shell-page', '#shell-stage']);
  });
});
