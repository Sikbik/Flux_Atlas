// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '../store/ui';
import { currentMode, installCount, installModeSync, isMotionMode, MODE_ATTR, modeOf } from './mode';

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

describe('motion mode', () => {
  beforeEach(() => {
    useUi.setState({ motion: 'system' });
    document.documentElement.removeAttribute(MODE_ATTR);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('lets the nearest data-fx-mode ancestor win over the preferences', () => {
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
  });

  it('mirrors the mode on <html> and switches live', () => {
    const mq = stubMatchMedia(false);
    const release = installModeSync();
    const root = document.documentElement;
    expect(root.getAttribute(MODE_ATTR)).toBe('full');
    useUi.setState({ motion: 'reduced' });
    expect(root.getAttribute(MODE_ATTR)).toBe('reduced');
    useUi.setState({ motion: 'system' });
    expect(root.getAttribute(MODE_ATTR)).toBe('full');
    mq.set(true);
    expect(root.getAttribute(MODE_ATTR)).toBe('reduced');
    useUi.setState({ motion: 'off' });
    expect(root.getAttribute(MODE_ATTR)).toBe('off');
    release();
  });

  it('cleans up: the last release removes the attribute and every listener', () => {
    const mq = stubMatchMedia(false);
    const r1 = installModeSync();
    const r2 = installModeSync(); // StrictMode style double install
    expect(installCount()).toBe(2);
    expect(mq.count()).toBe(1);
    r1();
    r1(); // idempotent
    expect(installCount()).toBe(1);
    expect(document.documentElement.getAttribute(MODE_ATTR)).toBe('full');
    r2();
    expect(installCount()).toBe(0);
    expect(document.documentElement.hasAttribute(MODE_ATTR)).toBe(false);
    expect(mq.count()).toBe(0);
    // No stale subscription is left on the store.
    useUi.setState({ motion: 'off' });
    expect(document.documentElement.hasAttribute(MODE_ATTR)).toBe(false);
  });
});
