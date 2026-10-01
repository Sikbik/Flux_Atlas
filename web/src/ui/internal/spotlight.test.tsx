// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpotlight } from './spotlight';
import { mount } from './testing';

function Surface() {
  const follow = useSpotlight<HTMLDivElement>();
  return <div data-testid="surface" onPointerMove={follow} style={{ width: 200, height: 100 }} />;
}

function move(el: Element, pointerType: string, x: number, y: number) {
  act(() => {
    const ev = new Event('pointermove', { bubbles: true });
    Object.defineProperties(ev, {
      pointerType: { value: pointerType },
      clientX: { value: x },
      clientY: { value: y },
    });
    el.dispatchEvent(ev);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSpotlight', () => {
  it('writes the pointer position relative to the element, once per frame', () => {
    const m = mount(<Surface />);
    const el = m.container.querySelector<HTMLElement>('[data-testid="surface"]');
    if (!el) throw new Error('missing surface');
    el.getBoundingClientRect = () => ({
      left: 100,
      top: 40,
      right: 300,
      bottom: 140,
      width: 200,
      height: 100,
      x: 100,
      y: 40,
      toJSON: () => ({}),
    });
    move(el, 'mouse', 130, 70);
    move(el, 'mouse', 150, 90);
    expect(el.style.getPropertyValue('--ui-mx')).toBe('');
    act(() => {
      vi.advanceTimersByTime(20);
    });
    // Both moves collapsed into one write using the latest sample.
    expect(el.style.getPropertyValue('--ui-mx')).toBe('50px');
    expect(el.style.getPropertyValue('--ui-my')).toBe('50px');
    m.unmount();
  });

  it('ignores touch and pen input', () => {
    const m = mount(<Surface />);
    const el = m.container.querySelector<HTMLElement>('[data-testid="surface"]');
    if (!el) throw new Error('missing surface');
    move(el, 'touch', 10, 10);
    move(el, 'pen', 10, 10);
    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect(el.style.getPropertyValue('--ui-mx')).toBe('');
    m.unmount();
  });
});
