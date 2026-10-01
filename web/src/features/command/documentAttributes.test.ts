// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { useUi } from '../../store/ui';
import { syncLayerAttribute, syncPerfAttribute } from './documentAttributes';

const html = () => document.documentElement;

afterEach(() => {
  for (const a of ['data-perf', 'data-motion', 'data-motion-off', 'data-layer-labels'])
    html().removeAttribute(a);
  useUi.setState({ perf: 'auto', motion: 'system' });
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

  it('never touches the motion attributes (the motion root owns data-motion, Off included)', () => {
    html().setAttribute('data-motion', 'off');
    useUi.setState({ perf: 'lite', motion: 'off' });
    syncPerfAttribute();
    expect(html().getAttribute('data-motion')).toBe('off');
    expect(html().hasAttribute('data-motion-off')).toBe(false);
    html().removeAttribute('data-motion');
    syncPerfAttribute();
    expect(html().hasAttribute('data-motion')).toBe(false);
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
