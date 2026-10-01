// @vitest-environment jsdom
import { act, StrictMode, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '../../store/ui';
import { mount } from '../../ui/internal/testing';
import { installCount, resetEngine, stats, useHost } from '../engine';
import type { Anim, Animate } from '../fxRunners';
import { MODE_ATTR, installCount as modeInstalls, ROOT_ATTR } from '../mode';
import { Current } from './Current';
import { useCharge, usePulse, useSpark } from './hooks';
import { MotionRoot } from './MotionRoot';
import { PowerOn } from './PowerOn';
import { TabIndicator } from './TabIndicator';

function fakeDriver() {
  const anims: (Anim & { el: Element; cancelled: boolean; finish(): void })[] = [];
  const animate: Animate = (el) => {
    let done!: () => void;
    const finished = new Promise<void>((r) => {
      done = r;
    });
    const a = {
      el,
      finished,
      cancelled: false,
      finish: () => done(),
      cancel() {
        a.cancelled = true;
      },
    };
    anims.push(a);
    return a;
  };
  return {
    animate,
    anims,
    finishAll: () => {
      for (const a of anims) a.finish();
    },
  };
}

const RECT = {
  x: 40,
  y: 40,
  left: 40,
  top: 40,
  right: 240,
  bottom: 120,
  width: 200,
  height: 80,
  toJSON: () => ({}),
} as DOMRect;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const root = () => document.documentElement;
const comets = () => document.querySelectorAll('.fx-comet').length;

describe('motion react layer', () => {
  let driver: ReturnType<typeof fakeDriver>;

  beforeEach(async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    // jsdom does not implement getComputedStyle for pseudo-elements and says so on stderr every call.
    const style = globalThis.getComputedStyle.bind(globalThis);
    vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((el) => style(el));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(RECT);
    useUi.setState({ motion: 'full' });
    root().removeAttribute(ROOT_ATTR);
    root().removeAttribute(MODE_ATTR);
    driver = fakeDriver();
    await useHost((r) => new r.Fx({ animate: driver.animate }));
  });

  afterEach(() => {
    resetEngine();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('MotionRoot', () => {
    it('installs the engine and the mode mirror, renders its children untouched, and cleans up on unmount', () => {
      const m = mount(
        <MotionRoot>
          <p id="child">hello</p>
        </MotionRoot>,
      );
      expect(m.container.innerHTML).toBe('<p id="child">hello</p>'); // no wrapper element
      expect(installCount()).toBe(1);
      expect(modeInstalls()).toBe(1);
      expect(root().getAttribute(ROOT_ATTR)).toBe('full');
      expect(root().getAttribute(MODE_ATTR)).toBe('full');
      m.unmount();
      expect(installCount()).toBe(0);
      expect(modeInstalls()).toBe(0);
      expect(root().hasAttribute(ROOT_ATTR)).toBe(false);
      expect(root().hasAttribute(MODE_ATTR)).toBe(false);
    });

    it('survives StrictMode double mounting with one install', () => {
      const m = mount(
        <StrictMode>
          <MotionRoot />
        </StrictMode>,
      );
      expect(installCount()).toBe(1);
      m.unmount();
      expect(installCount()).toBe(0);
    });

    it('follows the Settings choice live', () => {
      const m = mount(<MotionRoot />);
      act(() => useUi.setState({ motion: 'reduced' }));
      expect(root().getAttribute(ROOT_ATTR)).toBe('reduced');
      act(() => useUi.setState({ motion: 'off' }));
      expect(root().getAttribute(MODE_ATTR)).toBe('off');
      m.unmount();
    });
  });

  describe('Current', () => {
    const Card = ({ n, ...rest }: { n: number; fireOnMount?: boolean; disabled?: boolean }) => (
      <div style={{ position: 'relative' }}>
        <Current signal={n} edge="top" {...rest} />
      </div>
    );

    it('runs one streak when the signal changes, never on mount, and removes it when it ends', async () => {
      const m = mount(<Card n={1} />);
      expect(comets()).toBe(0);
      m.rerender(<Card n={1} />);
      expect(comets()).toBe(0);
      m.rerender(<Card n={2} />);
      expect(comets()).toBe(1);
      const track = m.container.querySelector('.fx-current') as HTMLElement;
      expect(track.querySelectorAll('.fx-comet')).toHaveLength(1); // drawn in its own track, not an overlay
      expect(track.getAttribute('aria-hidden')).toBe('true');
      await act(async () => {
        driver.finishAll();
        await tick();
      });
      expect(comets()).toBe(0);
      expect(stats()?.active).toBe(0);
      m.unmount();
    });

    it('does nothing when disabled', () => {
      const m = mount(<Card n={1} disabled />);
      m.rerender(<Card n={2} disabled />);
      expect(comets()).toBe(0);
      m.unmount();
    });

    it('runs once for a card that has just landed, even in StrictMode', () => {
      const m = mount(
        <StrictMode>
          <Card n={1} fireOnMount />
        </StrictMode>,
      );
      expect(comets()).toBe(1);
      m.unmount();
      expect(comets()).toBe(0); // unmounting cancels it
    });

    it('is quiet in reduced motion: one edge flash, no travelling light', () => {
      root().setAttribute(ROOT_ATTR, 'reduced');
      const m = mount(<Card n={1} />);
      m.rerender(<Card n={2} />);
      expect(comets()).toBe(0);
      expect(m.container.querySelectorAll('.fx-line')).toHaveLength(1);
      m.unmount();
    });
  });

  describe('PowerOn', () => {
    const Win = ({ open, onExited }: { open: boolean; onExited?: () => void }) => (
      <PowerOn open={open} onExited={onExited} origin={{ x: 10, y: 10 }}>
        <p id="win">window</p>
      </PowerOn>
    );

    it('mounts its children on open, plays the exit on close and unmounts when it ends', async () => {
      const onExited = vi.fn();
      const m = mount(<Win open={false} onExited={onExited} />);
      expect(m.container.querySelector('#win')).toBeNull();
      m.rerender(<Win open onExited={onExited} />);
      expect(m.container.querySelector('#win')).not.toBeNull();
      expect(driver.anims.length).toBeGreaterThan(0); // the entrance
      const before = driver.anims.length;
      m.rerender(<Win open={false} onExited={onExited} />);
      expect(driver.anims.length).toBeGreaterThan(before); // the exit
      expect(m.container.querySelector('#win')).not.toBeNull(); // still there while it plays
      expect(onExited).not.toHaveBeenCalled();
      await act(async () => {
        driver.finishAll();
        await tick();
      });
      expect(m.container.querySelector('#win')).toBeNull();
      expect(onExited).toHaveBeenCalledTimes(1);
      m.unmount();
    });

    it('comes back visible when it is re-opened while it is closing', async () => {
      const onExited = vi.fn();
      const m = mount(<Win open onExited={onExited} />);
      m.rerender(<Win open={false} onExited={onExited} />);
      m.rerender(<Win open onExited={onExited} />);
      await act(async () => {
        driver.finishAll();
        await tick();
      });
      expect(m.container.querySelector('#win')).not.toBeNull();
      expect(onExited).not.toHaveBeenCalled();
      m.unmount();
    });

    it('closes at once when motion is off', async () => {
      root().setAttribute(ROOT_ATTR, 'off');
      const onExited = vi.fn();
      const m = mount(<Win open onExited={onExited} />);
      expect(driver.anims).toHaveLength(0);
      m.rerender(<Win open={false} onExited={onExited} />);
      await act(async () => {
        await tick();
      });
      expect(m.container.querySelector('#win')).toBeNull();
      expect(onExited).toHaveBeenCalledTimes(1);
      m.unmount();
    });

    it('runs the panel variant as a quick entrance with a streak along the top', () => {
      const m = mount(
        <PowerOn open variant="panel">
          <p>toast</p>
        </PowerOn>,
      );
      expect(comets()).toBe(1);
      m.unmount();
      expect(comets()).toBe(0);
    });
  });

  describe('hooks', () => {
    it('usePulse pulses on pointer press of its element, can be switched off, and returns a trigger', () => {
      let trigger: ReturnType<typeof usePulse> | undefined;
      const Btn = ({ enabled }: { enabled: boolean }) => {
        const ref = useRef<HTMLButtonElement>(null);
        trigger = usePulse(ref, { enabled });
        return (
          <button type="button" ref={ref}>
            go
          </button>
        );
      };
      const m = mount(<Btn enabled />);
      const btn = m.container.querySelector('button') as HTMLButtonElement;
      act(() => {
        btn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 60 }));
      });
      expect(comets()).toBeGreaterThan(0);
      act(() => {
        trigger?.()?.cancel();
      });
      expect(comets()).toBe(0);
      m.rerender(<Btn enabled={false} />);
      act(() => {
        btn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 60 }));
      });
      expect(comets()).toBe(0);
      m.unmount();
    });

    it('useSpark fires when `on` turns true, not on mount and not when it turns off', () => {
      const Toggle = ({ on }: { on: boolean }) => {
        const ref = useRef<HTMLSpanElement>(null);
        useSpark(ref, on);
        return <span ref={ref}>x</span>;
      };
      const m = mount(<Toggle on={true} />);
      expect(document.querySelectorAll('.fx-spark')).toHaveLength(0);
      m.rerender(<Toggle on={false} />);
      expect(document.querySelectorAll('.fx-spark')).toHaveLength(0);
      m.rerender(<Toggle on={true} />);
      expect(document.querySelectorAll('.fx-spark')).toHaveLength(1);
      m.unmount();
      expect(document.querySelectorAll('.fx-spark')).toHaveLength(0);
    });

    it('useCharge adds the charge token and puts the attribute back on unmount', () => {
      const Box = ({ on }: { on: boolean }) => {
        const ref = useRef<HTMLDivElement>(null);
        useCharge(ref, on);
        return <div ref={ref} data-fx="press" />;
      };
      const m = mount(<Box on />);
      const el = m.container.firstElementChild as HTMLElement;
      expect(el.getAttribute('data-fx')).toBe('press charge');
      m.rerender(<Box on={false} />);
      expect(el.getAttribute('data-fx')).toBe('press');
      m.unmount();
    });
  });

  describe('TabIndicator', () => {
    it('places a line under the selected tab and follows the selection', () => {
      const Tabs = ({ sel }: { sel: number }) => (
        <div role="tablist" style={{ position: 'relative' }}>
          {['a', 'b', 'c'].map((t, i) => (
            <button key={t} type="button" role="tab" aria-selected={sel === i}>
              {t}
            </button>
          ))}
          <TabIndicator />
        </div>
      );
      const m = mount(<Tabs sel={0} />);
      const bar = m.container.querySelector('.fx-indicator') as HTMLElement;
      expect(bar.getAttribute('aria-hidden')).toBe('true');
      expect(bar.style.getPropertyValue('--fx-l')).toBe('0px'); // every rect is the same stub: left - left
      expect(bar.style.opacity).toBe('');
      m.rerender(<Tabs sel={2} />);
      expect(bar.style.getPropertyValue('--fx-r')).toBe('200px');
      m.unmount();
      expect(installCount()).toBe(0);
    });

    it('follows aria-current on a bar of routes (page, true, step) and not aria-current="false"', async () => {
      const Bar = ({ at }: { at: 'page' | 'step' | 'false' | undefined }) => (
        <nav style={{ position: 'relative' }}>
          <button type="button" aria-current={at}>
            home
          </button>
          <TabIndicator />
        </nav>
      );
      const m = mount(<Bar at="page" />);
      const bar = m.container.querySelector('.fx-indicator') as HTMLElement;
      expect(bar.style.opacity).toBe('');
      m.rerender(<Bar at="false" />);
      await tick(); // the indicator watches the attribute with a MutationObserver
      expect(bar.style.opacity).toBe('0');
      m.rerender(<Bar at="step" />);
      await tick();
      expect(bar.style.opacity).toBe('');
      m.unmount();
    });

    it('measures a host that is mid-scale in its own pixels (a panel still powering on)', () => {
      // The palette's chips mount while the panel is at 97%: every painted distance is 3% short.
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return this.getAttribute('role') === 'tablist' ? 200 : 0;
      });
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
        const rect = (left: number, width: number) =>
          ({ left, top: 0, right: left + width, bottom: 20, width, height: 20, x: left, y: 0 }) as DOMRect;
        if (this.getAttribute('role') === 'tablist') return rect(10, 194); // 200 wide, painted at 0.97
        if (this.getAttribute('aria-selected') === 'true') return rect(10 + 97, 58.2); // 100 in, 60 wide
        return RECT;
      });
      const m = mount(
        <div role="tablist" style={{ position: 'relative' }}>
          <button type="button" role="tab" aria-selected="true">
            a
          </button>
          <TabIndicator />
        </div>,
      );
      const bar = m.container.querySelector('.fx-indicator') as HTMLElement;
      expect(Number.parseFloat(bar.style.getPropertyValue('--fx-l'))).toBeCloseTo(100, 1);
      expect(Number.parseFloat(bar.style.getPropertyValue('--fx-r'))).toBeCloseTo(160, 1);
      m.unmount();
    });

    it('answers a resize in the next frame, never inside the observer delivery', () => {
      // A write made while resizes are being delivered can ask for another delivery in the same frame, which the
      // browser reports as a ResizeObserver loop error: the line waits for a frame, and one frame covers a burst.
      let deliver: () => void = () => undefined;
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(cb: () => void) {
            deliver = cb;
          }
          observe() {}
          disconnect() {}
        },
      );
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
      vi.stubGlobal('cancelAnimationFrame', () => undefined);
      let selectedLeft = 40;
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
        const rect = (left: number, width: number) =>
          ({ left, top: 0, right: left + width, bottom: 20, width, height: 20, x: left, y: 0 }) as DOMRect;
        return this.getAttribute('aria-selected') === 'true' ? rect(selectedLeft, 60) : rect(0, 200);
      });
      const m = mount(
        <div role="tablist" style={{ position: 'relative' }}>
          <button type="button" role="tab" aria-selected="true">
            a
          </button>
          <TabIndicator />
        </div>,
      );
      const bar = m.container.querySelector('.fx-indicator') as HTMLElement;
      expect(bar.style.getPropertyValue('--fx-l')).toBe('40px');
      frames.length = 0;
      selectedLeft = 70;
      deliver();
      deliver(); // a burst of resizes
      expect(bar.style.getPropertyValue('--fx-l')).toBe('40px'); // nothing is written inside the delivery
      expect(frames).toHaveLength(1); // and one frame answers them all
      frames[0]?.(0);
      expect(bar.style.getPropertyValue('--fx-l')).toBe('70px');
      m.unmount();
      vi.unstubAllGlobals();
    });

    it('does not rescale an ordinary host: a pixel of rounding in offsetWidth is not a transform', () => {
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return this.getAttribute('role') === 'tablist' ? 312 : 0; // painted 311.5 wide
      });
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
        const rect = (left: number, width: number) =>
          ({ left, top: 0, right: left + width, bottom: 20, width, height: 20, x: left, y: 0 }) as DOMRect;
        if (this.getAttribute('role') === 'tablist') return rect(0, 311.5);
        if (this.getAttribute('aria-selected') === 'true') return rect(250, 60);
        return RECT;
      });
      const m = mount(
        <div role="tablist" style={{ position: 'relative' }}>
          <button type="button" role="tab" aria-selected="true">
            a
          </button>
          <TabIndicator />
        </div>,
      );
      const bar = m.container.querySelector('.fx-indicator') as HTMLElement;
      expect(bar.style.getPropertyValue('--fx-l')).toBe('250px');
      expect(bar.style.getPropertyValue('--fx-r')).toBe('310px');
      m.unmount();
    });
  });
});
