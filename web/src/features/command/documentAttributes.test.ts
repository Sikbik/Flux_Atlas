// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installModeSync } from '../../motion/mode';
import { useUi } from '../../store/ui';
import { syncLayerAttribute } from './documentAttributes';

const html = () => document.documentElement;

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  for (const a of ['data-perf', 'data-layer-labels']) html().removeAttribute(a);
  useUi.setState({ perf: 'auto', motion: 'system' });
  vi.unstubAllGlobals();
});

describe('the motion root', () => {
  it('stays the one writer of the motion attributes, so Off stays Off beside this module', () => {
    // An earlier mirror here wrote `reduced` for Off, and the root took that for a mode the page forced.
    useUi.setState({ motion: 'off' });
    const release = installModeSync();
    expect(html().getAttribute('data-motion')).toBe('off');
    syncLayerAttribute('mesh,-labels');
    expect(html().getAttribute('data-motion')).toBe('off');
    expect(html().getAttribute('data-fx-mode')).toBe('off');
    // The Settings choice changes the store; the root follows it and this module stays out of the way.
    useUi.getState().setMotion('reduced');
    syncLayerAttribute(undefined);
    expect(html().getAttribute('data-motion')).toBe('reduced');
    expect(html().getAttribute('data-fx-mode')).toBe('reduced');
    release();
  });

  it('leaves <html data-perf> to the chrome', () => {
    useUi.setState({ perf: 'lite' });
    syncLayerAttribute('mesh');
    expect(html().hasAttribute('data-perf')).toBe(false);
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
