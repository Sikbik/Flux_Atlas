// @vitest-environment jsdom
import { act, createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '../../store/ui';
import { click, mount, press } from '../internal/testing';
import { BarList, type BarListItem } from './BarList';

const items: BarListItem[] = [
  { id: 'US', label: 'United States', value: 1450, detail: '21.6%' },
  { id: 'DE', label: 'Germany', value: 725, detail: '10.8%' },
  { id: 'FR', label: 'France', value: 290, detail: '4.3%' },
  { id: 'JP', label: 'Japan', value: 145, detail: '2.2%' },
  { id: 'BR', label: 'Brazil', value: 72, detail: '1.1%' },
];

const rows = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('.ui-barlist__item'));
const frac = (li: HTMLElement) => Number(li.style.getPropertyValue('--ui-bl-frac'));
const text = (li: HTMLElement, part: string) => li.querySelector(`.ui-barlist__${part}`)?.textContent;

beforeEach(() => {
  useUi.getState().setMotion('off');
});

describe('BarList rows', () => {
  it('renders each item with its label, a grouped integer value and the detail', () => {
    const m = mount(<BarList items={items} label="Top countries" />);
    const li = rows(m.container);
    expect(li).toHaveLength(5);
    expect(text(li[0] as HTMLElement, 'label')).toBe('United States');
    expect(text(li[0] as HTMLElement, 'value')).toBe('1,450');
    expect(text(li[0] as HTMLElement, 'detail')).toBe('21.6%');
    expect(m.container.querySelector('ul')?.getAttribute('aria-label')).toBe('Top countries');
    m.unmount();
  });

  it('uses the given display text for the value and omits the detail column when no item has one', () => {
    const m = mount(<BarList items={[{ id: 'a', label: 'A', value: 5, display: '5 nodes' }]} />);
    expect(text(rows(m.container)[0] as HTMLElement, 'value')).toBe('5 nodes');
    expect(m.container.querySelector('.ui-barlist__detail')).toBeNull();
    expect(m.container.querySelector('.ui-barlist')?.hasAttribute('data-detail')).toBe(false);
    m.unmount();
  });

  it('scales bars to the largest value by default, to the total when given, to max otherwise', () => {
    const byMax = mount(<BarList items={items} />);
    expect(rows(byMax.container).map(frac)).toEqual([1, 0.5, 0.2, 0.1, 0.0496551724137931]);
    byMax.unmount();

    const byTotal = mount(<BarList items={items} total={6700} />);
    expect(frac(rows(byTotal.container)[0] as HTMLElement)).toBeCloseTo(1450 / 6700, 6);
    byTotal.unmount();

    const byGivenMax = mount(<BarList items={items} max={2900} />);
    expect(frac(rows(byGivenMax.container)[0] as HTMLElement)).toBeCloseTo(0.5, 6);
    byGivenMax.unmount();
  });

  it('paints a per-item colour', () => {
    const m = mount(
      <BarList items={[{ ...items[0], color: 'var(--viz-3)' } as BarListItem, items[1] as BarListItem]} />,
    );
    const li = rows(m.container);
    expect(li[0]?.style.getPropertyValue('--ui-bl-c')).toBe('var(--viz-3)');
    expect(li[1]?.style.getPropertyValue('--ui-bl-c')).toBe('');
    m.unmount();
  });

  it('shows an unknown value as the word Unknown on an empty dashed track, never as zero', () => {
    const m = mount(
      <BarList items={[{ id: 'x', label: 'Mystery', value: null }, items[0] as BarListItem]} />,
    );
    const unknown = rows(m.container)[0] as HTMLElement;
    expect(text(unknown, 'value')).toBe('Unknown');
    expect(unknown.querySelector('.ui-barlist__track')?.hasAttribute('data-unknown')).toBe(true);
    expect(unknown.querySelector('.ui-barlist__fill')?.hasAttribute('data-none')).toBe(true);
    expect(frac(unknown)).toBe(0);
    m.unmount();
  });

  it('puts the full label in a title so a truncated name is still readable', () => {
    const m = mount(
      <BarList
        items={[
          { id: 'a', label: 'A very long organisation name that will not fit', value: 3 },
          { id: 'b', label: <b>Node</b>, title: 'Node B', value: 2 },
        ]}
      />,
    );
    const labels = Array.from(m.container.querySelectorAll('.ui-barlist__label'));
    expect(labels[0]?.getAttribute('title')).toBe('A very long organisation name that will not fit');
    expect(labels[1]?.getAttribute('title')).toBe('Node B');
    m.unmount();
  });

  it('sets the label column from labelWidth', () => {
    const m = mount(<BarList items={items} labelWidth={140} />);
    expect(
      (m.container.querySelector('.ui-barlist') as HTMLElement).style.getPropertyValue('--ui-bl-label'),
    ).toBe('140px');
    m.unmount();
    const g = mount(<BarList items={items} labelWidth="minmax(80px, 40%)" />);
    expect(
      (g.container.querySelector('.ui-barlist') as HTMLElement).style.getPropertyValue('--ui-bl-label'),
    ).toBe('minmax(80px, 40%)');
    g.unmount();
  });

  it('hides the decorative track from assistive technology', () => {
    const m = mount(<BarList items={items} />);
    expect(m.container.querySelector('.ui-barlist__track')?.getAttribute('aria-hidden')).toBe('true');
    m.unmount();
  });
});

describe('BarList interaction', () => {
  it('renders a link row for an entity and a plain row for neither', () => {
    const m = mount(
      <BarList
        items={[
          { id: 'US', label: 'United States', value: 2, to: { kind: 'country', value: 'US' } },
          { id: 'DE', label: 'Germany', value: 1 },
        ]}
      />,
    );
    const link = m.container.querySelector('a.ui-barlist__row') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/?cc=US');
    expect(link.getAttribute('data-kind')).toBe('link');
    const plain = m.container.querySelectorAll('.ui-barlist__row')[1] as HTMLElement;
    expect(plain.tagName).toBe('DIV');
    expect(plain.getAttribute('data-kind')).toBe('plain');
    m.unmount();
  });

  it('makes every row a button when the list has onSelect, and passes the item', () => {
    const onSelect = vi.fn();
    const m = mount(<BarList items={items} onSelect={onSelect} />);
    const buttons = m.container.querySelectorAll<HTMLButtonElement>('button.ui-barlist__row');
    expect(buttons).toHaveLength(5);
    click(buttons[1] as HTMLElement);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: 'DE' });
    m.unmount();
  });

  it('lets an item onSelect win over the list one', () => {
    const own = vi.fn();
    const list = vi.fn();
    const m = mount(<BarList items={[{ ...items[0], onSelect: own } as BarListItem]} onSelect={list} />);
    click(m.container.querySelector('button.ui-barlist__row') as HTMLElement);
    expect(own).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
    m.unmount();
  });

  it('marks the selected row with data-selected and the right aria state', () => {
    const m = mount(<BarList items={items} onSelect={() => {}} selectedId="DE" />);
    const buttons = Array.from(m.container.querySelectorAll<HTMLElement>('button.ui-barlist__row'));
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(buttons[1]?.hasAttribute('data-selected')).toBe(true);
    expect(buttons[0]?.hasAttribute('data-selected')).toBe(false);
    m.unmount();

    const links = mount(
      <BarList
        items={[{ id: 'US', label: 'United States', value: 2, to: { kind: 'country', value: 'US' } }]}
        selectedId="US"
      />,
    );
    expect(links.container.querySelector('a')?.getAttribute('aria-current')).toBe('true');
    links.unmount();
  });

  it('moves focus between interactive rows with the arrow keys, Home and End, without wrapping', () => {
    const m = mount(<BarList items={items} onSelect={() => {}} />);
    const buttons = Array.from(m.container.querySelectorAll<HTMLElement>('button.ui-barlist__row'));
    act(() => buttons[0]?.focus());
    press(buttons[0] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(buttons[1]);
    press(buttons[1] as HTMLElement, 'End');
    expect(document.activeElement).toBe(buttons[4]);
    press(buttons[4] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(buttons[4]);
    press(buttons[4] as HTMLElement, 'ArrowUp');
    expect(document.activeElement).toBe(buttons[3]);
    press(buttons[3] as HTMLElement, 'Home');
    expect(document.activeElement).toBe(buttons[0]);
    m.unmount();
  });
});

describe('BarList disclosure', () => {
  it('opens a row in place with renderOpen, several at once, and closes it again', () => {
    const m = mount(
      <BarList items={items} renderOpen={(item) => <p className="opened">Inside {String(item.label)}</p>} />,
    );
    const buttons = () =>
      Array.from(m.container.querySelectorAll<HTMLButtonElement>('button.ui-barlist__row'));
    expect(buttons()).toHaveLength(5);
    expect(buttons()[0]?.getAttribute('aria-expanded')).toBe('false');
    expect(m.container.querySelector('.opened')).toBeNull();

    click(buttons()[0] as HTMLElement);
    click(buttons()[2] as HTMLElement);
    const open = Array.from(m.container.querySelectorAll('.opened')).map((n) => n.textContent);
    expect(open).toEqual(['Inside United States', 'Inside France']);
    const first = buttons()[0] as HTMLButtonElement;
    expect(first.getAttribute('aria-expanded')).toBe('true');
    const panel = m.container.querySelector(`#${CSS.escape(first.getAttribute('aria-controls') ?? '')}`);
    expect(panel?.textContent).toBe('Inside United States');
    expect(panel?.getAttribute('aria-label')).toBe('United States');

    click(first);
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(first.hasAttribute('aria-controls')).toBe(false);
    expect(Array.from(m.container.querySelectorAll('.opened')).map((n) => n.textContent)).toEqual([
      'Inside France',
    ]);
    m.unmount();
  });

  it('turns link rows into disclosures rather than following the link', () => {
    const m = mount(
      <BarList
        items={[{ id: 'n', label: 'Node 1', value: 3, to: { kind: 'node', value: '1' } }]}
        renderOpen={() => <p className="opened">apps</p>}
      />,
    );
    expect(m.container.querySelector('a.ui-barlist__row')).toBeNull();
    click(m.container.querySelector('button.ui-barlist__row') as HTMLElement);
    expect(m.container.querySelector('.opened')?.textContent).toBe('apps');
    m.unmount();
  });
});

describe('BarList limit', () => {
  it('shows the limit and a Show all toggle that expands and collapses', () => {
    const m = mount(<BarList items={items} limit={3} />);
    expect(rows(m.container)).toHaveLength(3);
    const toggle = m.container.querySelector('.ui-barlist__more button') as HTMLButtonElement;
    expect(toggle.textContent).toContain('Show all 5');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    click(toggle);
    expect(rows(m.container)).toHaveLength(5);
    expect(toggle.textContent).toContain('Show fewer');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    click(toggle);
    expect(rows(m.container)).toHaveLength(3);
    m.unmount();
  });

  it('scales bars from all items so collapsing never rescales them', () => {
    const m = mount(<BarList items={[...items].reverse()} limit={2} />);
    // The two visible rows are Brazil and Japan; the scale still comes from the United States.
    expect(rows(m.container).map(frac)).toEqual([72 / 1450, 145 / 1450]);
    m.unmount();
  });

  it('has no toggle when everything fits', () => {
    const m = mount(<BarList items={items} limit={5} />);
    expect(m.container.querySelector('.ui-barlist__more')).toBeNull();
    m.unmount();
  });
});

describe('BarList states', () => {
  it('shows skeleton rows while loading, busy and hidden from assistive technology', () => {
    const m = mount(<BarList items={items} loading limit={4} />);
    const root = m.container.querySelector('.ui-barlist') as HTMLElement;
    expect(root.getAttribute('data-state')).toBe('loading');
    expect(root.getAttribute('aria-busy')).toBe('true');
    expect(m.container.querySelectorAll('.ui-barlist__item')).toHaveLength(4);
    expect(m.container.querySelector('.ui-barlist__label')).toBeNull();
    expect(m.container.textContent).toBe('');
    m.unmount();
  });

  it('defaults to five skeleton rows and honours skeletonRows', () => {
    const a = mount(<BarList items={[]} loading />);
    expect(a.container.querySelectorAll('.ui-barlist__item')).toHaveLength(5);
    a.unmount();
    const b = mount(<BarList items={[]} loading skeletonRows={3} />);
    expect(b.container.querySelectorAll('.ui-barlist__item')).toHaveLength(3);
    b.unmount();
  });

  it('says No data with the given sentence when empty', () => {
    const m = mount(<BarList items={[]} emptyText="No countries reported yet." />);
    const state = m.container.querySelector('[role="status"]') as HTMLElement;
    expect(state.textContent).toContain('No data');
    expect(state.textContent).toContain('No countries reported yet.');
    expect(m.container.querySelector('.ui-barlist')?.getAttribute('data-state')).toBe('empty');
    m.unmount();
  });

  it('replaces the empty state when given one', () => {
    const m = mount(<BarList items={[]} empty={<p>Pick a range</p>} />);
    expect(m.container.textContent).toBe('Pick a range');
    m.unmount();
  });
});

describe('BarList attach points', () => {
  it('forwards ref, className, style and other attributes to the root, keeping its own custom properties', () => {
    const ref = createRef<HTMLDivElement>();
    const m = mount(
      <BarList
        ref={ref}
        items={items}
        className="mine"
        style={{ maxWidth: 320 }}
        id="countries"
        data-testid="bl"
      />,
    );
    const root = m.container.querySelector('.ui-barlist') as HTMLElement;
    expect(ref.current).toBe(root);
    expect(root.classList.contains('mine')).toBe(true);
    expect(root.style.maxWidth).toBe('320px');
    expect(root.style.getPropertyValue('--ui-bl-value')).not.toBe('');
    expect(root.id).toBe('countries');
    expect(root.getAttribute('data-testid')).toBe('bl');
    expect(root.getAttribute('data-state')).toBe('ready');
    m.unmount();
  });

  it('marks a pressed row with data-pressed while the pointer or Enter is held', () => {
    const m = mount(<BarList items={items} onSelect={() => {}} />);
    const row = m.container.querySelector('button.ui-barlist__row') as HTMLElement;
    act(() => void row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
    expect(row.hasAttribute('data-pressed')).toBe(true);
    act(() => void row.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 })));
    expect(row.hasAttribute('data-pressed')).toBe(false);
    press(row, 'Enter');
    expect(row.hasAttribute('data-pressed')).toBe(true);
    m.unmount();
  });
});
