// @vitest-environment jsdom
// A link to a section of a hub (`/nodes#operators`) scrolls to it once the section has something to show.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../../ui/internal/testing';
import { useHashAnchor } from './useAnchor';

const state = vi.hoisted(() => ({ hash: '', mode: 'full' as 'full' | 'reduced' | 'off' }));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (s: { location: { hash: string } }) => string }) =>
    select({ location: { hash: state.hash } }),
}));
vi.mock('../../ui', () => ({ useMotionMode: () => state.mode }));

const scrollIntoView = vi.fn();

function Page({ ready }: { ready: boolean }) {
  useHashAnchor(ready);
  return (
    <div>
      <section id="operators" />
      <section id="activity" />
    </div>
  );
}

beforeEach(() => {
  state.hash = '';
  state.mode = 'full';
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useHashAnchor', () => {
  it('scrolls to the section the fragment names once the page is ready, gliding in full motion', () => {
    state.hash = '#operators';
    const m = mount(<Page ready={false} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    m.rerender(<Page ready />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
    expect(scrollIntoView.mock.contexts[0]).toBe(m.container.querySelector('#operators'));
    m.unmount();
  });

  it('jumps instead of gliding when motion is reduced or off', () => {
    state.hash = '#activity';
    for (const mode of ['reduced', 'off'] as const) {
      state.mode = mode;
      scrollIntoView.mockReset();
      const m = mount(<Page ready />);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
      m.unmount();
    }
  });

  it('does nothing without a fragment, or when no section has that name', () => {
    const m = mount(<Page ready />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    m.unmount();
    state.hash = '#nowhere';
    const n = mount(<Page ready />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    n.unmount();
  });
});
