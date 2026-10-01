// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { click, mount } from '../internal/testing';
import { Delta } from './Delta';
import { KeyValue } from './KeyValue';
import { Stat } from './Stat';

describe('Stat', () => {
  it('shows the label, the figure, the unit and the caption', () => {
    const m = mount(<Stat label="Block reward" value="14.00" unit="FLUX" caption="four outputs" />);
    const text = m.container.textContent ?? '';
    expect(text).toContain('Block reward');
    expect(text).toContain('14.00');
    expect(text).toContain('FLUX');
    expect(text).toContain('four outputs');
    m.unmount();
  });

  it('says Unknown for a missing figure, never zero or blank', () => {
    for (const v of [null, undefined, '']) {
      const m = mount(<Stat label="Collateral" value={v} />);
      expect(m.container.querySelector('.ui-stat__value')?.textContent).toBe('Unknown');
      m.unmount();
    }
  });

  it('keeps a real zero as a zero', () => {
    const m = mount(<Stat label="Unreachable" value="0" />);
    expect(m.container.querySelector('.ui-stat__value')?.textContent).toBe('0');
    m.unmount();
  });

  it('is busy while loading and shows no figure, but keeps its meta row so the size matches', () => {
    const m = mount(<Stat label="Nodes" loading />);
    const tile = m.container.querySelector('.ui-stat');
    expect(tile?.getAttribute('aria-busy')).toBe('true');
    expect(m.container.querySelector('.ui-stat__value')).toBeNull();
    expect(m.container.querySelector('.ui-stat__meta')).not.toBeNull();
    m.unmount();
  });

  it('shows No data with the reason instead of a figure when upstream is stale', () => {
    const m = mount(
      <Stat label="FLUX price" value="$0.07" delta={<Delta value={1} />} stale="Feed is 14 min old" />,
    );
    expect(m.container.querySelector('.ui-stat__value')?.textContent).toBe('No data');
    expect(m.container.textContent).toContain('Feed is 14 min old');
    expect(m.container.querySelector('.ui-delta')).toBeNull();
    m.unmount();
  });

  it('becomes one button when given onClick', () => {
    const onClick = vi.fn();
    const m = mount(<Stat label="Height" value="1" onClick={onClick} />);
    const b = m.container.querySelector('button.ui-stat');
    expect(b).not.toBeNull();
    if (b) click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
    m.unmount();
  });

  it('marks the hero tile, a sparkline slot and a tier tint with data attributes', () => {
    const m = mount(<Stat hero tier="stratus" label="Nodes" value="1" spark={<i data-testid="spark" />} />);
    const tile = m.container.querySelector('.ui-stat');
    expect(tile?.hasAttribute('data-hero')).toBe(true);
    expect(tile?.getAttribute('data-tier')).toBe('stratus');
    expect(tile?.hasAttribute('data-spark')).toBe(true);
    expect(m.container.querySelector('.ui-stat__spark [data-testid="spark"]')).not.toBeNull();
    m.unmount();
  });

  it('drops the sparkline while loading', () => {
    const m = mount(<Stat loading label="Nodes" spark={<i data-testid="spark" />} />);
    expect(m.container.querySelector('[data-testid="spark"]')).toBeNull();
    m.unmount();
  });
});

describe('Delta component', () => {
  it('renders a signed figure, a direction word for screen readers and the period', () => {
    const m = mount(<Delta value={23} period="today" />);
    expect(m.container.textContent).toContain('+23');
    expect(m.container.textContent).toContain('Up');
    expect(m.container.textContent).toContain('today');
    expect(m.container.querySelector('[data-dir="up"]')).not.toBeNull();
    m.unmount();
  });

  it('marks a fall as down and a change that rounds to nothing as flat', () => {
    const m = mount(
      <>
        <Delta value={-1204} />
        <Delta value={0.004} kind="percent" />
      </>,
    );
    const items = Array.from(m.container.querySelectorAll('.ui-delta'));
    expect(items[0]?.getAttribute('data-dir')).toBe('down');
    expect(items[1]?.getAttribute('data-dir')).toBe('flat');
    expect(items[1]?.textContent).toContain('0.00%');
    m.unmount();
  });

  it('says Unknown for a missing or non-finite change', () => {
    for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      const m = mount(<Delta value={v} />);
      expect(m.container.textContent).toBe('Unknown');
      m.unmount();
    }
  });
});

describe('KeyValue', () => {
  it('renders a definition list with a term and a value per row', () => {
    const m = mount(
      <KeyValue
        aria-label="Facts"
        items={[
          { label: 'Rank', value: 12 },
          { label: 'Tier', value: 'Stratus' },
        ]}
      />,
    );
    const dl = m.container.querySelector('dl');
    expect(dl?.getAttribute('aria-label')).toBe('Facts');
    expect(Array.from(m.container.querySelectorAll('dt')).map((d) => d.textContent)).toEqual([
      'Rank',
      'Tier',
    ]);
    expect(Array.from(m.container.querySelectorAll('dd')).map((d) => d.textContent)).toEqual([
      '12',
      'Stratus',
    ]);
    m.unmount();
  });

  it('groups numbers with separators and sets them in mono', () => {
    const m = mount(<KeyValue items={[{ label: 'Height', value: 2997616 }]} />);
    const v = m.container.querySelector('dd .ui-mono');
    expect(v?.textContent).toBe('2,997,616');
    m.unmount();
  });

  it('renders Unknown for null, undefined and empty values, or the word the row asks for', () => {
    const m = mount(
      <KeyValue
        items={[
          { label: 'A', value: null },
          { label: 'B', value: undefined },
          { label: 'C', value: '' },
          { label: 'D', value: null, unknown: 'Not reported' },
        ]}
      />,
    );
    expect(Array.from(m.container.querySelectorAll('dd')).map((d) => d.textContent)).toEqual([
      'Unknown',
      'Unknown',
      'Unknown',
      'Not reported',
    ]);
    m.unmount();
  });

  it('keeps a real zero', () => {
    const m = mount(<KeyValue items={[{ label: 'Rank', value: 0 }]} />);
    expect(m.container.querySelector('dd')?.textContent).toBe('0');
    m.unmount();
  });

  it('adds a labelled copy button when asked, copying the plain text value', () => {
    const m = mount(<KeyValue items={[{ label: 'Collateral', value: 'abc:0', mono: true, copy: true }]} />);
    const b = m.container.querySelector('button');
    expect(b?.getAttribute('aria-label')).toBe('Copy collateral');
    m.unmount();
  });

  it('opens external links safely in a new tab and keeps internal links in place', () => {
    const m = mount(
      <KeyValue
        items={[
          { label: 'Site', value: 'flux.io', href: 'https://flux.io' },
          { label: 'Node', value: 'x', href: '/node/x' },
        ]}
      />,
    );
    const links = Array.from(m.container.querySelectorAll('a'));
    expect(links[0]?.getAttribute('target')).toBe('_blank');
    expect(links[0]?.getAttribute('rel')).toContain('noopener');
    expect(links[1]?.getAttribute('target')).toBeNull();
    m.unmount();
  });

  it('shows a note under the value', () => {
    const m = mount(<KeyValue items={[{ label: 'Producer', value: 'x', note: 'as of block 12' }]} />);
    expect(m.container.querySelector('.ui-kv__note')?.textContent).toBe('as of block 12');
    m.unmount();
  });
});
