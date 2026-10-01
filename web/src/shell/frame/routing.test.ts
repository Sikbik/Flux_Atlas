import { describe, expect, it } from 'vitest';
import { initialWmState, wmReduce } from '../wm/machine';
import { TABBAR_H } from '../wm/specs';
import type { WmState } from '../wm/types';
import { insetFor } from './routing';

const desktop = (): WmState => initialWmState({ w: 1600, h: 900 }, { x: 0, y: 52, w: 1588, h: 716 });

// A 390 by 844 phone: the header ends at 158, the tab bar starts at 780.
const phone = (): WmState =>
  wmReduce(desktop(), {
    t: 'setViewport',
    viewport: { w: 390, h: 844 },
    workspace: { x: 0, y: 158, w: 390, h: 622 },
  });

describe('insetFor on the phone', () => {
  it('is the tab bar alone when nothing is open', () => {
    const s = phone();
    expect(s.layout).toBe('phone');
    expect(insetFor(s, false, false)).toMatchObject({ top: 158, bottom: TABBAR_H });
  });

  it('adds the Live sheet, which the window manager does not know', () => {
    expect(insetFor(phone(), false, true).bottom).toBe(TABBAR_H + 372);
  });

  it('lifts the globe clear of the time machine sheet resting on the tab bar', () => {
    expect(insetFor(phone(), false, false, 195).bottom).toBe(TABBAR_H + 195);
  });

  it('follows the taller of the two sheets, never their sum', () => {
    expect(insetFor(phone(), false, true, 195).bottom).toBe(TABBAR_H + 372);
    expect(insetFor(phone(), false, true, 500).bottom).toBe(TABBAR_H + 500);
  });
});

describe('insetFor on the desktop and in ambient', () => {
  it('leaves the desktop to the workspace, which already includes the rail and its strip', () => {
    const s = desktop();
    expect(insetFor(s, false, false, 195)).toEqual(insetFor(s, false, false));
    expect(insetFor(s, false, false).bottom).toBe(900 - (52 + 716));
  });

  it('is nothing in ambient mode', () => {
    expect(insetFor(phone(), true, true, 195, 800)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
});

describe('insetFor beside a page panel', () => {
  it('gives the globe the left side of a panel that stands in the stage, with the gap', () => {
    expect(insetFor(desktop(), false, false, 0, 800).left).toBe(824);
    expect(insetFor(desktop(), false, false, 0, 800)).toEqual({
      ...insetFor(desktop(), false, false),
      left: 824,
    });
  });

  it('reserves nothing for a panel with no edge (an empty slot) or one that would squeeze the planet out', () => {
    expect(insetFor(desktop(), false, false, 0, 0).left).toBe(0);
    expect(insetFor(desktop(), false, false, 0, 1400).left).toBe(0);
  });

  it('leaves the phone, where the panel is the page, to the sheets', () => {
    expect(insetFor(phone(), false, false, 0, 300).left).toBe(0);
    expect(insetFor(phone(), false, false, 0, 300)).toEqual(insetFor(phone(), false, false));
  });
});
