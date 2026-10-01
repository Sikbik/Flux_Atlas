// @vitest-environment jsdom
// The palette's host opens and closes the panel through the motion language's Power-on (panel variant): the
// slot is what it animates, the layer stays until the exit has played, and focus goes back afterwards.

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEngine, useHost } from '../../motion/engine';
import type { Anim, Animate } from '../../motion/fxRunners';
import { MODE_ATTR, ROOT_ATTR } from '../../motion/mode';
import { useUi } from '../../store/ui';
import { mount } from '../../ui/internal/testing';
import { PaletteHost } from './PaletteHost';
import { closePaletteViaHost } from './paletteBridge';
import { openPalette } from './paletteUrl';

// The real palette is a heavy lazy chunk; the host's job is what is tested here.
vi.mock('./palette/Palette', () => ({
  default: ({ phase }: { phase: string }) => (
    <div className="pal-panel" data-testid="palette" data-phase={phase}>
      <input aria-label="field" />
    </div>
  ),
}));

function fakeDriver() {
  const anims: (Anim & { cancelled: boolean; finish(): void })[] = [];
  const animate: Animate = () => {
    let done!: () => void;
    const finished = new Promise<void>((r) => {
      done = r;
    });
    const a = {
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
  x: 100,
  y: 100,
  left: 100,
  top: 100,
  right: 700,
  bottom: 330,
  width: 600,
  height: 230,
  toJSON: () => ({}),
} as DOMRect;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const settle = () =>
  act(async () => {
    await tick();
    await tick();
  });
const layer = () => document.querySelector('.pal-layer');
const slot = () => document.querySelector('.pal-slot');
const comets = () => document.querySelectorAll('.fx-comet').length;

function routerForTest() {
  const root = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <PaletteHost />
      </>
    ),
  });
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <button type="button" id="launcher">
        launcher
      </button>
    ),
  });
  return createRouter({
    routeTree: root.addChildren([home]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
}

describe('PaletteHost', () => {
  let driver: ReturnType<typeof fakeDriver>;

  beforeEach(async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const style = globalThis.getComputedStyle.bind(globalThis);
    vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((el) => style(el));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(RECT);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); // the router restores scroll; jsdom has none
    useUi.setState({ motion: 'full' });
    document.documentElement.removeAttribute(ROOT_ATTR);
    document.documentElement.removeAttribute(MODE_ATTR);
    driver = fakeDriver();
    await useHost((r) => new r.Fx({ animate: driver.animate }));
  });

  afterEach(() => {
    resetEngine();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function opened() {
    const router = routerForTest();
    const m = mount(<RouterProvider router={router} />);
    await settle();
    const launcher = document.getElementById('launcher') as HTMLButtonElement;
    launcher.focus();
    act(() => openPalette(router, ''));
    await settle();
    return { router, m, launcher };
  }

  it('is not there until the URL carries q', async () => {
    const router = routerForTest();
    const m = mount(<RouterProvider router={router} />);
    await settle();
    expect(layer()).toBeNull();
    m.unmount();
  });

  it('opens into a slot that Power-on scales in, with one light along its top edge', async () => {
    const { m } = await opened();
    expect(layer()?.getAttribute('data-phase')).toBe('open');
    expect(slot()).not.toBeNull();
    expect(slot()?.querySelector('[data-testid="palette"]')).not.toBeNull();
    expect(driver.anims.length).toBeGreaterThan(0); // the entrance on the slot
    expect(comets()).toBe(1);
    m.unmount();
  });

  it('keeps the panel mounted while the exit plays, and unmounts and returns focus when it ends', async () => {
    const { m, launcher } = await opened();
    const before = driver.anims.length;
    act(() => {
      closePaletteViaHost();
    });
    await settle();
    expect(layer()?.getAttribute('data-phase')).toBe('closing');
    expect(slot()?.querySelector('[data-testid="palette"]')?.getAttribute('data-phase')).toBe('closing');
    expect(driver.anims.length).toBeGreaterThan(before); // the exit
    await act(async () => {
      driver.finishAll();
      await tick();
      await tick();
    });
    expect(layer()).toBeNull();
    expect(document.activeElement).toBe(launcher);
    m.unmount();
  });

  it('closes at once when motion is off, and still gives focus back', async () => {
    document.documentElement.setAttribute(ROOT_ATTR, 'off');
    const { m, launcher } = await opened();
    expect(driver.anims).toHaveLength(0);
    act(() => {
      closePaletteViaHost();
    });
    await settle();
    expect(layer()).toBeNull();
    expect(document.activeElement).toBe(launcher);
    m.unmount();
  });

  it('brings the same panel back when it is opened again while it is closing', async () => {
    const { router, m } = await opened();
    act(() => {
      closePaletteViaHost();
    });
    await settle();
    expect(layer()?.getAttribute('data-phase')).toBe('closing');
    const panel = slot()?.querySelector('[data-testid="palette"]');
    act(() => openPalette(router, ''));
    await settle();
    await act(async () => {
      driver.finishAll();
      await tick();
    });
    expect(layer()?.getAttribute('data-phase')).toBe('open');
    expect(slot()?.querySelector('[data-testid="palette"]')).toBe(panel);
    m.unmount();
  });
});
