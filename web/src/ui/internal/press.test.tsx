// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { pressHandlers } from './press';
import { mount } from './testing';

function Pressable({ onPointerDown, onKeyDown }: { onPointerDown?: () => void; onKeyDown?: () => void }) {
  return (
    <button type="button" data-testid="b" {...pressHandlers<HTMLButtonElement>({ onPointerDown, onKeyDown })}>
      press
    </button>
  );
}

function pointer(el: Element, type: string, button = 0) {
  act(() => {
    const ev = new Event(type, { bubbles: true });
    Object.defineProperty(ev, 'button', { value: button });
    el.dispatchEvent(ev);
  });
}

function key(el: Element, type: 'keydown' | 'keyup', k: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
  });
}

describe('pressHandlers', () => {
  it('marks data-pressed while the primary pointer button is held, and clears it on release', () => {
    const m = mount(<Pressable />);
    const b = m.container.querySelector('button');
    if (!b) throw new Error('missing');
    pointer(b, 'pointerdown');
    expect(b.hasAttribute('data-pressed')).toBe(true);
    pointer(b, 'pointerup');
    expect(b.hasAttribute('data-pressed')).toBe(false);
    m.unmount();
  });

  it('ignores secondary buttons', () => {
    const m = mount(<Pressable />);
    const b = m.container.querySelector('button');
    if (!b) throw new Error('missing');
    pointer(b, 'pointerdown', 2);
    expect(b.hasAttribute('data-pressed')).toBe(false);
    m.unmount();
  });

  it('clears when the pointer leaves or the gesture is cancelled', () => {
    const m = mount(<Pressable />);
    const b = m.container.querySelector('button');
    if (!b) throw new Error('missing');
    pointer(b, 'pointerdown');
    pointer(b, 'pointerout');
    expect(b.hasAttribute('data-pressed')).toBe(false);
    pointer(b, 'pointerdown');
    pointer(b, 'pointercancel');
    expect(b.hasAttribute('data-pressed')).toBe(false);
    m.unmount();
  });

  it('follows Space and Enter, and lets go on blur', () => {
    const m = mount(<Pressable />);
    const b = m.container.querySelector('button');
    if (!b) throw new Error('missing');
    key(b, 'keydown', ' ');
    expect(b.hasAttribute('data-pressed')).toBe(true);
    key(b, 'keyup', ' ');
    expect(b.hasAttribute('data-pressed')).toBe(false);
    key(b, 'keydown', 'Enter');
    expect(b.hasAttribute('data-pressed')).toBe(true);
    act(() => {
      b.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(b.hasAttribute('data-pressed')).toBe(false);
    key(b, 'keydown', 'a');
    expect(b.hasAttribute('data-pressed')).toBe(false);
    m.unmount();
  });

  it('still runs the caller own handlers', () => {
    const onPointerDown = vi.fn();
    const onKeyDown = vi.fn();
    const m = mount(<Pressable onPointerDown={onPointerDown} onKeyDown={onKeyDown} />);
    const b = m.container.querySelector('button');
    if (!b) throw new Error('missing');
    pointer(b, 'pointerdown');
    key(b, 'keydown', 'x');
    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    m.unmount();
  });
});
