// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installModeSync } from '../../motion/mode';
import { useUi } from '../../store/ui';
import { syncLayerAttribute, syncPerfAttribute } from './documentAttributes';

const html = () => document.documentElement;

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  for (const a of ['data-perf', 'data-layer-labels']) html().removeAttribute(a);
  useUi.setState({ perf: 'auto', motion: 'system' });
  vi.unstubAllGlobals();
});

describe('syncPerfAttribute', () => {
  it('mirrors the high and lite tiers and leaves the others as the default', () => {
    useUi.setState({ perf: 'lite' });
    syncPerfAttribute();
    expect(html().getAttribute('data-perf')).toBe('lite');
    useUi.setState({ perf: 'high' });
    syncPerfAttribute();
    expect(html().getAttribute('data-perf')).toBe('high');
    for (const perf of ['auto', 'balanced'] as const) {
      useUi.setState({ perf });
      syncPerfAttribute();
      expect(html().hasAttribute('data-perf')).toBe(false);
    }
  });

  it('leaves the motion attributes to the motion root, so Off stays Off beside it', () => {
    // The motion root is the one writer of <html data-motion> and <html data-fx-mode>; run its own sync and
    // let this module mirror around it. (An earlier mirror here wrote `reduced` for Off, and the root took
    // that for a mode the page forced.)
    useUi.setState({ motion: 'off', perf: 'lite' });
    const release = installModeSync();
    expect(html().getAttribute('data-motion')).toBe('off');
    syncPerfAttribute();
    expect(html().getAttribute('data-perf')).toBe('lite');
    expect(html().getAttribute('data-motion')).toBe('off');
    expect(html().getAttribute('data-fx-mode')).toBe('off');
    // The Settings choice changes the store; the root follows it and this module stays out of the way.
    useUi.getState().setMotion('reduced');
    syncPerfAttribute();
    expect(html().getAttribute('data-motion')).toBe('reduced');
    expect(html().getAttribute('data-fx-mode')).toBe('reduced');
    release();
  });
});

describe('syncLayerAttribute', () => {
  it('hides the place labels while the layers say -labels', () => {
    syncLayerAttribute('mesh,-labels');
    expect(html().getAttribute('data-layer-labels')).toBe('off');
    syncLayerAttribute('mesh,flow');
    expect(html().hasAttribute('data-layer-labels')).toBe(false);
    syncLayerAttribute(undefined);
    expect(html().hasAttribute('data-layer-labels')).toBe(false);
  });
});
