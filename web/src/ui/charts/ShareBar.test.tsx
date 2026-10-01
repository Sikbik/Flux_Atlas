// @vitest-environment jsdom
import { act, createRef } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUi } from '../../store/ui';
import { mount } from '../internal/testing';
import { ShareBar, type ShareSegment } from './ShareBar';

const tiers: ShareSegment[] = [
  { id: 'cumulus', label: 'Cumulus', value: 3393, tier: 'cumulus' },
  { id: 'nimbus', label: 'Nimbus', value: 1580, tier: 'nimbus' },
  { id: 'stratus', label: 'Stratus', value: 1763, tier: 'stratus' },
];

const segs = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('.ui-sharebar__seg'));
const items = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('.ui-sharebar__item'));
const hover = (el: Element) =>
  act(() => void el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));
const leave = (el: Element) =>
  act(() => void el.dispatchEvent(new MouseEvent('pointerout', { bubbles: true })));

beforeEach(() => {
  useUi.getState().setMotion('off');
});

describe('ShareBar', () => {
  it('is one labelled image whose name spells out every share, and hides the legend from assistive technology', () => {
    const m = mount(<ShareBar segments={tiers} label="Node tiers" />);
    const bar = m.container.querySelector('.ui-sharebar__bar') as HTMLElement;
    expect(bar.getAttribute('role')).toBe('img');
    expect(bar.getAttribute('aria-label')).toBe(
      'Node tiers: Cumulus 3,393 (50.4%), Nimbus 1,580 (23.5%), Stratus 1,763 (26.2%)',
    );
    expect(m.container.querySelector('.ui-sharebar__legend')?.getAttribute('aria-hidden')).toBe('true');
    m.unmount();
  });

  it('weights segments in thousandths of the whole and titles each with its figures', () => {
    const m = mount(<ShareBar segments={tiers} />);
    const s = segs(m.container);
    expect(s).toHaveLength(3);
    expect(Number(s[0]?.style.getPropertyValue('--ui-sb-share'))).toBeCloseTo((3393 / 6736) * 1000, 3);
    expect(s[0]?.getAttribute('title')).toBe('Cumulus 3,393 (50.4%)');
    expect(s[0]?.style.getPropertyValue('--ui-sb-c')).toBe('var(--tier-cumulus-ink)');
    m.unmount();
  });

  it('draws no segment for a zero or unknown value but keeps its legend entry', () => {
    const m = mount(
      <ShareBar
        segments={[
          { id: 'a', label: 'Alpha', value: 10 },
          { id: 'b', label: 'Beta', value: 0 },
          { id: 'c', label: 'Gamma', value: null },
        ]}
      />,
    );
    expect(segs(m.container)).toHaveLength(1);
    const rows = items(m.container);
    expect(rows).toHaveLength(3);
    expect(rows[1]?.textContent).toContain('0');
    expect(rows[2]?.textContent).toContain('Unknown');
    expect(rows[2]?.querySelector('.ui-sharebar__pct')?.textContent).toBe('');
    m.unmount();
  });

  it('lists the amount and a one-decimal share per part, or just one of them', () => {
    const both = mount(<ShareBar segments={tiers} />);
    const first = items(both.container)[0] as HTMLElement;
    expect(first.querySelector('.ui-sharebar__name')?.textContent).toBe('Cumulus');
    expect(first.querySelector('.ui-sharebar__val')?.textContent).toBe('3,393');
    expect(first.querySelector('.ui-sharebar__pct')?.textContent).toBe('50.4%');
    both.unmount();

    const pct = mount(<ShareBar segments={tiers} show="percent" />);
    expect(pct.container.querySelector('.ui-sharebar__val')).toBeNull();
    expect(pct.container.querySelector('.ui-sharebar__pct')).not.toBeNull();
    pct.unmount();

    const val = mount(<ShareBar segments={tiers} show="value" format={(n) => `${n} nodes`} />);
    expect(val.container.querySelector('.ui-sharebar__pct')).toBeNull();
    expect(val.container.querySelector('.ui-sharebar__val')?.textContent).toBe('3393 nodes');
    val.unmount();
  });

  it('shows the tier glyph for tier segments so tier is never colour alone', () => {
    const m = mount(<ShareBar segments={tiers} />);
    const glyphs = m.container.querySelectorAll('.ui-sharebar__legend .ui-tier-glyph');
    expect(glyphs).toHaveLength(3);
    expect(glyphs[2]?.getAttribute('data-tier')).toBe('stratus');
    m.unmount();
  });

  it('colours plain segments from the categorical slots in order and the unknown one gray and hatched', () => {
    const m = mount(
      <ShareBar
        segments={[
          { id: 'a', label: 'A', value: 5 },
          { id: 'b', label: 'B', value: 5 },
          { id: 'u', label: 'Unknown', value: 5, unknown: true },
        ]}
      />,
    );
    const s = segs(m.container);
    expect(s.map((e) => e.style.getPropertyValue('--ui-sb-c'))).toEqual([
      'var(--viz-1)',
      'var(--viz-2)',
      'var(--status-off)',
    ]);
    expect(s[2]?.hasAttribute('data-unknown')).toBe(true);
    expect(m.container.querySelector('.ui-sharebar__key[data-unknown]')).not.toBeNull();
    m.unmount();
  });

  it('draws an empty track for the part of the total no segment covers', () => {
    const m = mount(<ShareBar segments={[{ id: 'a', label: 'Seen', value: 25 }]} total={100} />);
    const s = segs(m.container);
    expect(s).toHaveLength(2);
    expect(s[1]?.hasAttribute('data-rest')).toBe(true);
    expect(Number(s[1]?.style.getPropertyValue('--ui-sb-share'))).toBeCloseTo(750, 3);
    expect(m.container.querySelector('.ui-sharebar__pct')?.textContent).toBe('25.0%');
    m.unmount();
  });

  it('marks the part under the pointer in the bar and its legend entry', () => {
    const m = mount(<ShareBar segments={tiers} />);
    const bar = m.container.querySelector('.ui-sharebar__bar') as HTMLElement;
    hover(segs(m.container)[1] as HTMLElement);
    expect(bar.hasAttribute('data-active')).toBe(true);
    expect(segs(m.container).map((e) => e.hasAttribute('data-active'))).toEqual([false, true, false]);
    expect(items(m.container).map((e) => e.hasAttribute('data-active'))).toEqual([false, true, false]);
    leave(segs(m.container)[1] as HTMLElement);
    expect(bar.hasAttribute('data-active')).toBe(false);
    expect(items(m.container).some((e) => e.hasAttribute('data-active'))).toBe(false);
    hover(items(m.container)[2] as HTMLElement);
    expect(segs(m.container).map((e) => e.hasAttribute('data-active'))).toEqual([false, false, true]);
    m.unmount();
  });

  it('can hide the legend or list it as rows', () => {
    const none = mount(<ShareBar segments={tiers} legend="none" />);
    expect(none.container.querySelector('.ui-sharebar__legend')).toBeNull();
    none.unmount();
    const list = mount(<ShareBar segments={tiers} legend="list" />);
    expect(list.container.querySelector('.ui-sharebar')?.getAttribute('data-legend')).toBe('list');
    list.unmount();
  });

  it('uses the 16 px bar at size lg', () => {
    const m = mount(<ShareBar segments={tiers} size="lg" />);
    expect(m.container.querySelector('.ui-sharebar')?.getAttribute('data-size')).toBe('lg');
    m.unmount();
  });
});

describe('ShareBar states and attach points', () => {
  it('shows a busy skeleton with no image role while loading', () => {
    const m = mount(<ShareBar segments={[]} loading />);
    const root = m.container.querySelector('.ui-sharebar') as HTMLElement;
    expect(root.getAttribute('data-state')).toBe('loading');
    expect(root.getAttribute('aria-busy')).toBe('true');
    expect(m.container.querySelector('[role="img"]')).toBeNull();
    expect(m.container.textContent).toBe('');
    m.unmount();
  });

  it('says No data when nothing has a value, or the given text', () => {
    const none = mount(<ShareBar segments={[{ id: 'a', label: 'A', value: null }]} label="Reach" />);
    expect(none.container.querySelector('.ui-sharebar')?.getAttribute('data-state')).toBe('empty');
    expect(none.container.textContent).toContain('No data');
    expect(none.container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Reach: no data');
    none.unmount();
    const custom = mount(<ShareBar segments={[]} emptyText="No nodes reported" />);
    expect(custom.container.textContent).toContain('No nodes reported');
    custom.unmount();
  });

  it('reports ready state and forwards ref, className, style and other attributes to the root', () => {
    const ref = createRef<HTMLDivElement>();
    const m = mount(
      <ShareBar
        ref={ref}
        segments={tiers}
        className="mine"
        style={{ width: 240 }}
        data-testid="tiers"
        id="tier-share"
      />,
    );
    const root = m.container.querySelector('.ui-sharebar') as HTMLElement;
    expect(ref.current).toBe(root);
    expect(root.classList.contains('mine')).toBe(true);
    expect(root.style.width).toBe('240px');
    expect(root.getAttribute('data-testid')).toBe('tiers');
    expect(root.id).toBe('tier-share');
    expect(root.getAttribute('data-state')).toBe('ready');
    m.unmount();
  });
});
