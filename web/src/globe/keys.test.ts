import { describe, expect, it } from 'vitest';
import { cameraKeyFor, globeTakesKeys, KEY_OWNERS } from './keys';

/** A stand-in element: `closest` answers whether any of `inside` matches one of the owner selectors. */
function el(inside: string[] = []): Element {
  const owners = KEY_OWNERS.split(',');
  return {
    closest: (sel: string) =>
      sel === KEY_OWNERS && inside.some((s) => owners.includes(s)) ? ({} as Element) : null,
    isContentEditable: false,
  } as unknown as Element;
}

const ev = (over: Partial<Parameters<typeof globeTakesKeys>[0]> = {}) => ({
  target: el(),
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  defaultPrevented: false,
  ...over,
});

describe('cameraKeyFor', () => {
  it('maps the design 10.4 keys', () => {
    expect(cameraKeyFor('ArrowLeft', false)).toEqual({ kind: 'orbit', x: -1, y: 0 });
    expect(cameraKeyFor('ArrowUp', false)).toEqual({ kind: 'orbit', x: 0, y: 1 });
    expect(cameraKeyFor('ArrowRight', true)).toEqual({ kind: 'turn', heading: 1, tilt: 0 });
    expect(cameraKeyFor('ArrowDown', true)).toEqual({ kind: 'turn', heading: 0, tilt: -1 });
    expect(cameraKeyFor('+', false)).toEqual({ kind: 'zoom', steps: 1 });
    expect(cameraKeyFor('=', false)).toEqual({ kind: 'zoom', steps: 1 });
    expect(cameraKeyFor('-', false)).toEqual({ kind: 'zoom', steps: -1 });
    expect(cameraKeyFor('Home', false)).toEqual({ kind: 'home' });
    expect(cameraKeyFor('f', false)).toEqual({ kind: 'focus' });
    expect(cameraKeyFor('F', true)).toBe(null);
    expect(cameraKeyFor('g', false)).toBe(null);
    expect(cameraKeyFor('m', false)).toBe(null);
  });
});

describe('globeTakesKeys', () => {
  it('takes keys on the bare page', () => {
    expect(globeTakesKeys(ev(), null, false)).toBe(true);
  });

  it('never while a field, a menu, a list, a dialog or a window has focus', () => {
    for (const owner of [
      'input',
      'textarea',
      '[role="menu"]',
      '[role="listbox"]',
      '[role="dialog"]',
      '.wm-window',
    ])
      expect(globeTakesKeys(ev({ target: el([owner]) }), null, false)).toBe(false);
    // The focus elsewhere than the event's target still counts.
    expect(globeTakesKeys(ev(), el(['.wm-window']), false)).toBe(false);
  });

  it('never while the palette is open, with a modifier, or after someone handled the key', () => {
    expect(globeTakesKeys(ev(), null, true)).toBe(false);
    expect(globeTakesKeys(ev({ ctrlKey: true }), null, false)).toBe(false);
    expect(globeTakesKeys(ev({ altKey: true }), null, false)).toBe(false);
    expect(globeTakesKeys(ev({ defaultPrevented: true }), null, false)).toBe(false);
    expect(globeTakesKeys(ev({ isComposing: true }), null, false)).toBe(false);
  });
});
