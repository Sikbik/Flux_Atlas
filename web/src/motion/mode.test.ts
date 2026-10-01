// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type MotionPref, useUi } from '../store/ui';
import { rootMotion as kitRootMotion, resolveMotion } from '../ui/internal/useMotion';
import {
  currentMode,
  documentMode,
  installCount,
  installModeSync,
  isMotionMode,
  MODE_ATTR,
  modeOf,
  ROOT_ATTR,
  rootMotion,
} from './mode';

type MqlListener = () => void;

function stubMatchMedia(reduced: boolean) {
  const listeners = new Set<MqlListener>();
  const mql = {
    matches: reduced,
    addEventListener: (_: string, fn: MqlListener) => listeners.add(fn),
    removeEventListener: (_: string, fn: MqlListener) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', () => mql);
  return {
    set(v: boolean) {
      mql.matches = v;
      for (const fn of [...listeners]) fn();
    },
    count: () => listeners.size,
  };
}

/** Lets the MutationObserver on <html> deliver. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const root = () => document.documentElement;

describe('motion mode', () => {
  beforeEach(() => {
    useUi.setState({ motion: 'system' });
    root().removeAttribute(MODE_ATTR);
    root().removeAttribute(ROOT_ATTR);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('follows the OS preference on `system` and obeys an explicit choice', () => {
    const mq = stubMatchMedia(false);
    expect(currentMode()).toBe('full');
    mq.set(true);
    expect(currentMode()).toBe('reduced');
    useUi.setState({ motion: 'full' });
    expect(currentMode()).toBe('full'); // a deliberate Full beats the OS
    useUi.setState({ motion: 'off' });
    expect(currentMode()).toBe('off');
    useUi.setState({ motion: 'reduced' });
    expect(currentMode()).toBe('reduced');
  });

  it('validates mode strings', () => {
    expect(isMotionMode('full')).toBe(true);
    expect(isMotionMode('off')).toBe(true);
    expect(isMotionMode('system')).toBe(false);
    expect(isMotionMode(null)).toBe(false);
  });

  it('resolves like the UI kit: the root attribute, then the preference, then the OS', () => {
    const prefs: MotionPref[] = ['system', 'full', 'reduced', 'off'];
    for (const os of [false, true]) {
      stubMatchMedia(os);
      for (const pref of prefs) {
        for (const forced of [null, 'full', 'reduced', 'off', 'bogus'] as const) {
          useUi.setState({ motion: pref });
          if (forced === null) root().removeAttribute(ROOT_ATTR);
          else root().setAttribute(ROOT_ATTR, forced);
          expect(rootMotion(), `root ${forced}`).toBe(kitRootMotion());
          expect(documentMode(), `os=${os} pref=${pref} forced=${forced}`).toBe(
            kitRootMotion() ?? resolveMotion(pref, os),
          );
        }
      }
    }
  });

  it('lets the nearest data-fx-mode ancestor win over everything else', () => {
    stubMatchMedia(false);
    document.body.innerHTML = `
      <div ${MODE_ATTR}="reduced"><p id="a"><b id="deep"></b></p></div>
      <div ${MODE_ATTR}="off"><div ${MODE_ATTR}="full"><i id="inner"></i></div></div>
      <u id="bare"></u>`;
    expect(modeOf(document.getElementById('deep'))).toBe('reduced');
    expect(modeOf(document.getElementById('inner'))).toBe('full');
    expect(modeOf(document.getElementById('bare'))).toBe('full');
    useUi.setState({ motion: 'off' });
    expect(modeOf(document.getElementById('bare'))).toBe('off');
    expect(modeOf(null)).toBe('off');
    root().setAttribute(ROOT_ATTR, 'reduced');
    expect(modeOf(document.getElementById('bare'))).toBe('reduced');
    expect(modeOf(document.getElementById('deep'))).toBe('reduced');
    expect(modeOf(document.getElementById('inner'))).toBe('full');
  });

  describe('the mirror', () => {
    it('writes the effective mode to <html data-motion> and <html data-fx-mode> and follows changes', () => {
      const mq = stubMatchMedia(false);
      const release = installModeSync();
      expect(root().getAttribute(ROOT_ATTR)).toBe('full');
      expect(root().getAttribute(MODE_ATTR)).toBe('full');
      useUi.setState({ motion: 'reduced' });
      expect(root().getAttribute(ROOT_ATTR)).toBe('reduced');
      expect(root().getAttribute(MODE_ATTR)).toBe('reduced');
      useUi.setState({ motion: 'system' });
      expect(root().getAttribute(ROOT_ATTR)).toBe('full');
      mq.set(true);
      expect(root().getAttribute(ROOT_ATTR)).toBe('reduced');
      useUi.setState({ motion: 'off' });
      expect(root().getAttribute(ROOT_ATTR)).toBe('off');
      expect(root().getAttribute(MODE_ATTR)).toBe('off');
      release();
    });

    it('never overrides a mode the page forced', async () => {
      stubMatchMedia(false);
      root().setAttribute(ROOT_ATTR, 'off'); // a screenshot run, a gallery
      const release = installModeSync();
      expect(root().getAttribute(ROOT_ATTR)).toBe('off');
      expect(root().getAttribute(MODE_ATTR)).toBe('off');
      useUi.setState({ motion: 'reduced' }); // the preference changes underneath a forced mode
      expect(root().getAttribute(ROOT_ATTR)).toBe('off');
      expect(root().getAttribute(MODE_ATTR)).toBe('off');
      // Forcing another mode is picked up.
      root().setAttribute(ROOT_ATTR, 'full');
      await flush();
      expect(root().getAttribute(MODE_ATTR)).toBe('full');
      // Releasing the force hands control back: the attribute mirrors the preference again.
      root().removeAttribute(ROOT_ATTR);
      await flush();
      expect(root().getAttribute(ROOT_ATTR)).toBe('reduced');
      expect(root().getAttribute(MODE_ATTR)).toBe('reduced');
      release();
    });

    it('cleans up: the last release removes what it wrote, and every listener', () => {
      const mq = stubMatchMedia(false);
      const r1 = installModeSync();
      const r2 = installModeSync(); // StrictMode style double install
      expect(installCount()).toBe(2);
      expect(mq.count()).toBe(1);
      r1();
      r1(); // idempotent
      expect(installCount()).toBe(1);
      expect(root().getAttribute(ROOT_ATTR)).toBe('full');
      r2();
      expect(installCount()).toBe(0);
      expect(root().hasAttribute(ROOT_ATTR)).toBe(false);
      expect(root().hasAttribute(MODE_ATTR)).toBe(false);
      expect(mq.count()).toBe(0);
      // No stale subscription is left on the store.
      useUi.setState({ motion: 'off' });
      expect(root().hasAttribute(ROOT_ATTR)).toBe(false);
      expect(root().hasAttribute(MODE_ATTR)).toBe(false);
    });

    it('leaves a forced attribute in place on release', () => {
      stubMatchMedia(false);
      root().setAttribute(ROOT_ATTR, 'reduced');
      const release = installModeSync();
      release();
      expect(root().getAttribute(ROOT_ATTR)).toBe('reduced');
      expect(root().hasAttribute(MODE_ATTR)).toBe(false);
    });
  });
});
