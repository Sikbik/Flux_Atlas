// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobeProvider } from '../../globe/context';
import { installModeSync } from '../../motion/mode';
import { useUi } from '../../store/ui';
import { mount } from '../../ui/internal/testing';
import { useRootPrefs } from './prefs';

const html = () => document.documentElement;

function Probe() {
  useRootPrefs();
  return null;
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  for (const a of ['data-motion', 'data-fx-mode', 'data-motion-off', 'data-perf']) html().removeAttribute(a);
  useUi.setState({ perf: 'auto', motion: 'system' });
  vi.unstubAllGlobals();
});

describe('useRootPrefs and the motion root', () => {
  it('leaves data-motion to the motion root, so Off stays Off for the kit and the effects', () => {
    useUi.setState({ motion: 'off' });
    const release = installModeSync();
    const m = mount(
      <GlobeProvider>
        <Probe />
      </GlobeProvider>,
    );
    // The frame's stylesheets keep their marker, and the root says Off (it used to be written as `reduced`).
    expect(html().hasAttribute('data-motion-off')).toBe(true);
    expect(html().getAttribute('data-motion')).toBe('off');
    expect(html().getAttribute('data-fx-mode')).toBe('off');
    m.unmount();
    release();
  });

  it('follows the Settings choice: the marker goes with Off, the mode follows the root', () => {
    useUi.setState({ motion: 'off' });
    const release = installModeSync();
    const m = mount(
      <GlobeProvider>
        <Probe />
      </GlobeProvider>,
    );
    useUi.getState().setMotion('reduced');
    expect(html().getAttribute('data-motion')).toBe('reduced');
    expect(html().getAttribute('data-fx-mode')).toBe('reduced');
    // the marker is cleared by the hook's effect, after the render the store change causes
    return Promise.resolve().then(() => {
      expect(html().hasAttribute('data-motion-off')).toBe(false);
      m.unmount();
      release();
    });
  });
});
