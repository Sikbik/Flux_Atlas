// @vitest-environment jsdom
// A window that opens or maximizes plays a scale transform. The size a chart is drawn at must be the element's layout
// size, not the animation's frame, or the chart keeps the size of the first frame after the window has settled.

import { act, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../../../ui/internal/testing';
import { layoutSize, useSize } from './useSize';

function box(rect: { width: number; height: number }, offset: { w: number; h: number }): HTMLElement {
  return {
    getBoundingClientRect: () => ({
      ...rect,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: rect.width,
      bottom: rect.height,
    }),
    offsetWidth: offset.w,
    offsetHeight: offset.h,
  } as unknown as HTMLElement;
}

describe('layoutSize', () => {
  it('is the bounding box when nothing scales it, fractions kept', () => {
    expect(layoutSize(box({ width: 581.4, height: 136.25 }, { w: 581, h: 136 }))).toEqual({
      width: 581.4,
      height: 136.25,
    });
  });

  it('takes an ancestor scale back out: the first frames of a window opening or maximizing', () => {
    const half = layoutSize(box({ width: 300, height: 150 }, { w: 600, h: 300 }));
    expect(half.width).toBeCloseTo(600);
    expect(half.height).toBeCloseTo(300);
    const wide = layoutSize(box({ width: 610, height: 331 }, { w: 1005, h: 331 }));
    expect(wide.width).toBeCloseTo(1005);
    expect(wide.height).toBe(331);
  });

  it('uses the bounding box where there is no layout (jsdom): the sizes are 0', () => {
    expect(layoutSize(box({ width: 600, height: 300 }, { w: 0, h: 0 }))).toEqual({ width: 600, height: 300 });
  });

  it('is zero for an element that is not shown', () => {
    expect(layoutSize(box({ width: 0, height: 0 }, { w: 0, h: 0 }))).toEqual({ width: 0, height: 0 });
  });
});

describe('useSize', () => {
  const originals = {
    rect: HTMLElement.prototype.getBoundingClientRect,
    ro: globalThis.ResizeObserver,
  };

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originals.rect;
    globalThis.ResizeObserver = originals.ro;
    vi.restoreAllMocks();
  });

  function Probe({ onSize }: { onSize: (w: number) => void }) {
    const ref = useRef<HTMLDivElement>(null);
    onSize(useSize(ref).width);
    return <div ref={ref} />;
  }

  it('reports the layout width, and the layout width again when the observer fires', () => {
    // The first read is mid-animation (the box is scaled to half); the observer then fires with the transform still on.
    let scale = 0.5;
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({
        width: 800 * scale,
        height: 200 * scale,
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }) as DOMRect;
    let fire: () => void = () => undefined;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        fire = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    const seen: number[] = [];
    const m = mount(<Probe onSize={(w) => seen.push(w)} />);
    expect(seen[seen.length - 1]).toBeCloseTo(800);
    scale = 0.9;
    act(() => fire());
    expect(seen[seen.length - 1]).toBeCloseTo(800);
    scale = 1;
    act(() => fire());
    expect(seen[seen.length - 1]).toBeCloseTo(800);
    m.unmount();
  });
});
