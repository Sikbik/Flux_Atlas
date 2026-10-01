// @vitest-environment jsdom
// The strip marks the chosen kind with `data-selected` and hosts the motion language's TabIndicator, which
// follows that attribute: the chips carry no selection mark of their own.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEngine } from '../../../motion/engine';
import { mount } from '../../../ui/internal/testing';
import { KindStrip } from './KindStrip';
import type { KindChip } from './types';

const COUNTS: Record<KindChip, number> = { all: 0, nodes: 3, apps: 0, blocks: 1, addresses: 0, goto: 2 };

const chips = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('.pal-kind')];
const selected = (root: ParentNode) =>
  chips(root)
    .filter((c) => c.getAttribute('data-selected') === 'true')
    .map((c) => c.textContent);

describe('KindStrip', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    resetEngine();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('marks exactly the chosen chip, and moves the mark with the choice', () => {
    const m = mount(<KindStrip chip="all" counts={COUNTS} showCounts onPick={() => {}} />);
    expect(selected(m.container)).toEqual(['All']);
    m.rerender(<KindStrip chip="nodes" counts={COUNTS} showCounts onPick={() => {}} />);
    expect(selected(m.container)).toEqual(['Nodes3']);
    expect(
      chips(m.container)
        .find((c) => c.textContent?.startsWith('Nodes'))
        ?.getAttribute('aria-checked'),
    ).toBe('true');
    m.unmount();
  });

  it('hosts one selection line as the last child of the strip, hidden from assistive technology', () => {
    const m = mount(<KindStrip chip="all" counts={COUNTS} showCounts={false} onPick={() => {}} />);
    const strip = m.container.querySelector('.pal-kinds') as HTMLElement;
    expect(strip.querySelectorAll('.fx-indicator')).toHaveLength(1);
    expect(strip.lastElementChild?.classList.contains('fx-indicator')).toBe(true);
    expect(strip.lastElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(strip.getAttribute('role')).toBe('radiogroup');
    m.unmount();
  });

  it('shows counts only while there is text to count matches of, and never on All', () => {
    const m = mount(<KindStrip chip="all" counts={COUNTS} showCounts onPick={() => {}} />);
    expect(chips(m.container).map((c) => c.querySelector('i')?.textContent ?? '')).toEqual([
      '',
      '3',
      '',
      '1',
      '',
      '2',
    ]);
    m.rerender(<KindStrip chip="all" counts={COUNTS} showCounts={false} onPick={() => {}} />);
    expect(m.container.querySelectorAll('.pal-kind i')).toHaveLength(0);
    m.unmount();
  });

  it('keeps the chips out of the tab order and reports a pick', () => {
    const picked: KindChip[] = [];
    const m = mount(<KindStrip chip="all" counts={COUNTS} showCounts onPick={(id) => picked.push(id)} />);
    expect(chips(m.container).every((c) => c.tabIndex === -1)).toBe(true);
    (chips(m.container)[2] as HTMLElement).click();
    expect(picked).toEqual(['apps']);
    m.unmount();
  });
});
