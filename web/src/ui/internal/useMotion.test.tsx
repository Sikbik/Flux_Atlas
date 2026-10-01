// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { flush, mount } from './testing';
import { resolveMotion, rootMotion, useMotionMode } from './useMotion';

const html = document.documentElement;

afterEach(() => {
  delete html.dataset.motion;
});

describe('resolveMotion', () => {
  it('lets an explicit preference win over the OS setting', () => {
    expect(resolveMotion('full', true)).toBe('full');
    expect(resolveMotion('reduced', false)).toBe('reduced');
    expect(resolveMotion('off', false)).toBe('off');
  });

  it('follows the OS setting for the system preference', () => {
    expect(resolveMotion('system', true)).toBe('reduced');
    expect(resolveMotion('system', false)).toBe('full');
  });
});

describe('useMotionMode', () => {
  function Mode() {
    return <span data-testid="mode">{useMotionMode()}</span>;
  }

  it('reads the root data-motion attribute only when it names a mode', () => {
    expect(rootMotion()).toBeNull();
    html.dataset.motion = 'reduced';
    expect(rootMotion()).toBe('reduced');
    html.dataset.motion = 'sideways';
    expect(rootMotion()).toBeNull();
  });

  it('follows the kit mode without the attribute, and the attribute over it', () => {
    const m = mount(<Mode />);
    expect(m.container.textContent).toBe('full');
    m.unmount();
    html.dataset.motion = 'off';
    const forced = mount(<Mode />);
    expect(forced.container.textContent).toBe('off');
    forced.unmount();
  });

  it('updates when the attribute changes while mounted', async () => {
    const m = mount(<Mode />);
    expect(m.container.textContent).toBe('full');
    await act(async () => {
      html.dataset.motion = 'reduced';
      await Promise.resolve();
    });
    expect(m.container.textContent).toBe('reduced');
    flush(() => {});
    m.unmount();
  });
});
