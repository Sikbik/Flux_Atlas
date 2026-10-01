// @vitest-environment jsdom
import { Rocket } from 'lucide-react';
import { act, createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { click, mount } from '../internal/testing';
import { DiffBlock } from './DiffBlock';
import { Timeline, type TimelineItem } from './Timeline';

const html = document.documentElement;
const T = Date.UTC(2026, 8, 30, 12, 0, 0);

afterEach(() => {
  delete html.dataset.motion;
});

const history = (): TimelineItem[] => [
  {
    id: 'updated',
    time: T,
    title: 'Spec updated',
    block: 2950118,
    meta: 'paid 3.61 FLUX',
    icon: Rocket,
    tone: 'hot',
    children: <p>detail text</p>,
  },
  { id: 'renewed', time: 'Sep 2025 to Aug 2026', title: 'Renewed', count: 9, tone: 'neutral' },
  { id: 'registered', time: Number.NaN, title: 'Registered', tone: 'ok' },
];

describe('Timeline', () => {
  it('is an ordered list with one item per event, named by its label', () => {
    const m = mount(<Timeline label="App spec history" items={history()} />);
    const list = m.container.querySelector('ol') as HTMLElement;
    expect(list.getAttribute('role')).toBe('list');
    expect(list.getAttribute('aria-label')).toBe('App spec history');
    expect(list.querySelectorAll(':scope > li')).toHaveLength(3);
    m.unmount();
  });

  it('marks tone, the last item and the marker kind on each row', () => {
    const m = mount(<Timeline items={history()} />);
    const rows = [...m.container.querySelectorAll('li')];
    expect(rows.map((r) => r.getAttribute('data-tone'))).toEqual(['hot', 'neutral', 'ok']);
    expect(rows.map((r) => r.hasAttribute('data-last'))).toEqual([false, false, true]);
    expect(rows[0]?.querySelector('.ui-tl__marker')?.hasAttribute('data-icon')).toBe(true);
    expect(rows[1]?.querySelector('.ui-tl__marker')?.hasAttribute('data-icon')).toBe(false);
    m.unmount();
  });

  it('shows a block height, a string time as given, and Unknown for a time it cannot read', () => {
    const m = mount(<Timeline items={history()} />);
    const rows = [...m.container.querySelectorAll('li')];
    expect(rows[0]?.querySelector('.ui-tl__block')?.textContent).toBe('Block 2,950,118');
    expect(rows[1]?.querySelector('.ui-tl__time')?.textContent).toBe('Sep 2025 to Aug 2026');
    expect(rows[2]?.querySelector('.ui-tl__time')?.textContent).toBe('Unknown');
    m.unmount();
  });

  it('shows a grouped run as its verb and a count, which the screen reader hears whole', () => {
    const m = mount(<Timeline items={history()} />);
    const row = m.container.querySelectorAll('li')[1] as HTMLElement;
    expect(row.querySelector('.ui-tl__count .ui-sr-only')?.textContent).toBe('9');
    expect(row.querySelector('.ui-tl__count')?.textContent).toContain('times');
    m.unmount();
  });

  it('prints relative times as ages and absolute times as UTC date and time', () => {
    const rel = mount(<Timeline items={[{ id: 1, time: Date.now() - 5 * 60_000, title: 'Paid' }]} />);
    expect(rel.container.querySelector('time')?.textContent).toMatch(/^5 min ago$/);
    expect(rel.container.querySelector('time')?.getAttribute('dateTime')).toMatch(/^\d{4}-\d\d-\d\dT/);
    rel.unmount();

    const abs = mount(<Timeline timeMode="absolute" items={[{ id: 1, time: T, title: 'Paid' }]} />);
    expect(abs.container.querySelector('time')?.textContent).toContain('2026-09-30');
    expect(abs.container.querySelector('time')?.textContent).toContain('12:00');
    abs.unmount();
  });

  describe('disclosure', () => {
    it('makes an item with children a button with aria-expanded and a controlled, inert detail', () => {
      const m = mount(<Timeline items={history()} />);
      const row = m.container.querySelector('li') as HTMLElement;
      const button = row.querySelector('button') as HTMLButtonElement;
      const detail = row.querySelector('.ui-tl__detail') as HTMLElement;
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(button.getAttribute('aria-controls')).toBe(detail.id);
      expect(detail.hasAttribute('inert')).toBe(true);
      expect(row.getAttribute('data-state')).toBe('closed');

      click(button);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(detail.hasAttribute('inert')).toBe(false);
      expect(row.getAttribute('data-state')).toBe('open');

      click(button);
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(row.getAttribute('data-state')).toBe('closed');
      m.unmount();
    });

    it('has no button and no state on an item without children', () => {
      const m = mount(<Timeline items={history()} />);
      const plain = m.container.querySelectorAll('li')[2] as HTMLElement;
      expect(plain.querySelector('button')).toBeNull();
      expect(plain.hasAttribute('data-state')).toBe(false);
      m.unmount();
    });

    it('starts open with defaultOpen', () => {
      const items = history();
      items[0] = { ...(items[0] as TimelineItem), defaultOpen: true };
      const m = mount(<Timeline items={items} />);
      expect(m.container.querySelector('li')?.getAttribute('data-state')).toBe('open');
      expect(m.container.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
      m.unmount();
    });

    it('shows data-pressed on the button while a pointer or Space is held', () => {
      const m = mount(<Timeline items={history()} />);
      const button = m.container.querySelector('button') as HTMLButtonElement;
      act(() => {
        const down = new Event('pointerdown', { bubbles: true });
        Object.defineProperty(down, 'button', { value: 0 });
        button.dispatchEvent(down);
      });
      expect(button.hasAttribute('data-pressed')).toBe(true);
      act(() => {
        button.dispatchEvent(new Event('pointerup', { bubbles: true }));
      });
      expect(button.hasAttribute('data-pressed')).toBe(false);
      act(() => {
        button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      });
      expect(button.hasAttribute('data-pressed')).toBe(true);
      act(() => {
        button.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
      });
      expect(button.hasAttribute('data-pressed')).toBe(false);
      m.unmount();
    });
  });

  describe('live insertion', () => {
    const one: TimelineItem = { id: 'a', time: T, title: 'A' };
    const two: TimelineItem = { id: 'b', time: T - 1000, title: 'B' };
    const fresh: TimelineItem = { id: 'c', time: T + 1000, title: 'C' };

    it('never animates the first batch, but animates a row added afterwards', () => {
      const m = mount(<Timeline live items={[one, two]} />);
      expect(m.container.querySelectorAll('[data-enter]')).toHaveLength(0);
      m.rerender(<Timeline live items={[fresh, one, two]} />);
      const entering = m.container.querySelectorAll('[data-enter]');
      expect(entering).toHaveLength(1);
      expect(entering[0]).toBe(m.container.querySelector('li'));
      expect(entering[0]?.textContent).toContain('C');
      m.unmount();
    });

    it('does nothing without the live option', () => {
      const m = mount(<Timeline items={[one, two]} />);
      m.rerender(<Timeline items={[fresh, one, two]} />);
      expect(m.container.querySelectorAll('[data-enter]')).toHaveLength(0);
      m.unmount();
    });

    it('does nothing when motion is off', () => {
      html.dataset.motion = 'off';
      const m = mount(<Timeline live items={[one, two]} />);
      m.rerender(<Timeline live items={[fresh, one, two]} />);
      expect(m.container.querySelectorAll('[data-enter]')).toHaveLength(0);
      expect(m.container.querySelector('.ui-tl')?.getAttribute('data-mode')).toBe('off');
      m.unmount();
    });

    it('still marks the row under reduced motion, which the CSS turns into a 120 ms fade', () => {
      html.dataset.motion = 'reduced';
      const m = mount(<Timeline live items={[one, two]} />);
      m.rerender(<Timeline live items={[fresh, one, two]} />);
      expect(m.container.querySelectorAll('[data-enter]')).toHaveLength(1);
      expect(m.container.querySelector('.ui-tl')?.getAttribute('data-mode')).toBe('reduced');
      m.unmount();
    });

    it('does not animate the history of an entity that was empty and then loaded all at once', () => {
      const m = mount(<Timeline live items={[]} />);
      m.rerender(<Timeline live items={[one, two]} />);
      // The rows mount after the first non-empty render was decided: the first batch is not an insertion.
      expect(m.container.querySelectorAll('[data-enter]')).toHaveLength(0);
      m.unmount();
    });
  });

  it('shows the empty node inside the root, with data-state empty', () => {
    const m = mount(<Timeline items={[]} empty={<p>Nothing yet</p>} />);
    const root = m.container.firstElementChild as HTMLElement;
    expect(root.getAttribute('data-state')).toBe('empty');
    expect(root.textContent).toBe('Nothing yet');
    expect(m.container.querySelector('ol')).toBeNull();
    m.unmount();
  });

  it('forwards ref, className, style and exposes the live and time modes on the root', () => {
    const ref = createRef<HTMLDivElement>();
    const m = mount(
      <Timeline
        ref={ref}
        live
        timeMode="absolute"
        items={history()}
        className="x"
        style={{ width: 300 }}
        id="t"
      />,
    );
    expect(ref.current).toBe(m.container.firstElementChild);
    expect(ref.current?.className).toBe('ui-tl x');
    expect(ref.current?.style.width).toBe('300px');
    expect(ref.current?.id).toBe('t');
    expect(ref.current?.hasAttribute('data-live')).toBe(true);
    expect(ref.current?.getAttribute('data-time')).toBe('absolute');
    expect(ref.current?.getAttribute('data-mode')).toBe('full');
    m.unmount();
  });
});

describe('DiffBlock', () => {
  const lines = [
    { kind: 'ctx', text: '{ "name": "App",' },
    { kind: 'del', text: '  "version": 2,' },
    { kind: 'add', text: '  "version": 3,' },
  ] as const;

  it('is a labelled figure with one line per change, each marked by kind', () => {
    const m = mount(<DiffBlock lines={lines} />);
    const fig = m.container.querySelector('figure') as HTMLElement;
    expect(fig.getAttribute('aria-label')).toBe('Changes');
    const rows = [...fig.querySelectorAll('.ui-diff__line')];
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(['ctx', 'del', 'add']);
    m.unmount();
  });

  it('puts the sign in the gutter and says Added and Removed to screen readers', () => {
    const m = mount(<DiffBlock lines={lines} label="Changes in spec version 3" />);
    const rows = [...m.container.querySelectorAll('.ui-diff__line')];
    expect(m.container.querySelector('figure')?.getAttribute('aria-label')).toBe('Changes in spec version 3');
    expect(rows.map((r) => r.querySelector('.ui-diff__sign')?.textContent)).toEqual(['', '-', '+']);
    expect(rows[0]?.querySelector('.ui-sr-only')).toBeNull();
    expect(rows[1]?.querySelector('.ui-sr-only')?.textContent).toBe('Removed: ');
    expect(rows[2]?.querySelector('.ui-sr-only')?.textContent).toBe('Added: ');
    expect(rows[2]?.querySelector('.ui-diff__text')?.textContent).toBe('  "version": 3,');
    m.unmount();
  });

  it('forwards ref, className and style', () => {
    const ref = createRef<HTMLElement>();
    const m = mount(<DiffBlock ref={ref} lines={lines} className="x" style={{ margin: 3 }} />);
    expect(ref.current).toBe(m.container.firstElementChild);
    expect(ref.current?.className).toBe('ui-diff x');
    expect(ref.current?.style.margin).toBe('3px');
    m.unmount();
  });
});
