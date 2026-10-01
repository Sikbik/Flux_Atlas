// @vitest-environment jsdom
import { Layers } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { click, flush, mount, press } from '../internal/testing';
import { type TabItem, TabPanel, Tabs } from './Tabs';

const ITEMS: readonly TabItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'io', label: 'Inputs and outputs', badge: 12 },
  { id: 'raw', label: 'Raw', disabled: true },
  { id: 'peers', label: 'Peers', icon: Layers, badge: 'new' },
];

function tabs(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
}

function Harness({
  start = 'overview',
  onChange,
  activation,
  id,
}: {
  start?: string;
  onChange?: (id: string) => void;
  activation?: 'auto' | 'manual';
  id?: string;
}) {
  const [value, setValue] = useState(start);
  return (
    <>
      <Tabs
        aria-label="Sections"
        items={ITEMS}
        value={value}
        activation={activation}
        id={id}
        onChange={(next) => {
          onChange?.(next);
          setValue(next);
        }}
      />
      {id ? ITEMS.map((i) => <TabPanel key={i.id} id={i.id} value={value} tabsId={id} />) : null}
    </>
  );
}

describe('Tabs', () => {
  it('renders a labelled tablist with the selected tab and one tab stop', () => {
    const m = mount(<Harness start="io" />);
    const list = m.container.querySelector('[role="tablist"]');
    expect(list?.getAttribute('aria-label')).toBe('Sections');
    const t = tabs(m.container);
    expect(t.map((b) => b.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false']);
    expect(t.map((b) => b.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(t[2]?.disabled).toBe(true);
    m.unmount();
  });

  it('formats numeric badges and passes text through', () => {
    const m = mount(
      <Tabs
        aria-label="x"
        items={[...ITEMS, { id: 'big', label: 'Big', badge: 12345 }]}
        value="overview"
        onChange={() => {}}
      />,
    );
    const badges = Array.from(m.container.querySelectorAll('.ui-tabs__badge')).map((b) => b.textContent);
    expect(badges).toEqual(['12', 'new', '12.3K']);
    m.unmount();
  });

  it('selects with arrow keys, skipping disabled tabs, and wraps', () => {
    const onChange = vi.fn();
    const m = mount(<Harness onChange={onChange} />);
    let t = tabs(m.container);
    t[0]?.focus();
    press(t[0]!, 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('io');
    expect(document.activeElement).toBe(tabs(m.container)[1]);
    press(document.activeElement as HTMLElement, 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('peers');
    press(document.activeElement as HTMLElement, 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('overview');
    press(document.activeElement as HTMLElement, 'ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith('peers');
    t = tabs(m.container);
    expect(t.map((b) => b.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false', 'true']);
    m.unmount();
  });

  it('jumps with Home and End', () => {
    const onChange = vi.fn();
    const m = mount(<Harness start="io" onChange={onChange} />);
    const active = () => document.activeElement as HTMLElement;
    tabs(m.container)[1]?.focus();
    press(active(), 'End');
    expect(onChange).toHaveBeenLastCalledWith('peers');
    press(active(), 'Home');
    expect(onChange).toHaveBeenLastCalledWith('overview');
    m.unmount();
  });

  it('moves focus only with manual activation; click selects', () => {
    const onChange = vi.fn();
    const m = mount(<Harness activation="manual" onChange={onChange} />);
    tabs(m.container)[0]?.focus();
    press(document.activeElement as HTMLElement, 'ArrowRight');
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(tabs(m.container)[1]);
    // The roving tab stop follows focus while it is inside the list.
    expect(tabs(m.container).map((b) => b.tabIndex)).toEqual([-1, 0, -1, -1]);
    click(document.activeElement as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('io');
    m.unmount();
  });

  it('returns the tab stop to the selected tab when focus leaves', () => {
    const m = mount(
      <>
        <Harness activation="manual" />
        <button type="button" id="outside">
          outside
        </button>
      </>,
    );
    tabs(m.container)[0]?.focus();
    press(document.activeElement as HTMLElement, 'ArrowRight');
    expect(tabs(m.container).map((b) => b.tabIndex)).toEqual([-1, 0, -1, -1]);
    flush(() => (m.container.querySelector('#outside') as HTMLElement).focus());
    expect(tabs(m.container).map((b) => b.tabIndex)).toEqual([0, -1, -1, -1]);
    m.unmount();
  });

  it('does not report a click on the selected tab, and ignores disabled tabs', () => {
    const onChange = vi.fn();
    const m = mount(<Harness onChange={onChange} />);
    const t = tabs(m.container);
    click(t[0]!);
    click(t[2]!);
    expect(onChange).not.toHaveBeenCalled();
    click(t[3]!);
    expect(onChange).toHaveBeenCalledWith('peers');
    m.unmount();
  });

  it('wires aria-controls and aria-labelledby to the panels when given an id', () => {
    const m = mount(<Harness id="t1" start="io" />);
    const t = tabs(m.container);
    expect(t[1]?.getAttribute('aria-controls')).toBe('t1-panel-io');
    const panel = m.container.querySelector('#t1-panel-io');
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel?.getAttribute('aria-labelledby')).toBe(t[1]?.id);
    expect(panel?.hasAttribute('hidden')).toBe(false);
    expect(m.container.querySelector('#t1-panel-overview')?.hasAttribute('hidden')).toBe(true);
    m.unmount();
  });

  it('leaves aria-controls off without an id', () => {
    const m = mount(<Harness />);
    expect(tabs(m.container)[0]?.hasAttribute('aria-controls')).toBe(false);
    m.unmount();
  });

  it('mounts panel content only while active unless kept', () => {
    const m = mount(
      <>
        <TabPanel id="a" value="a" tabsId="x">
          <span id="ca">A</span>
        </TabPanel>
        <TabPanel id="b" value="a" tabsId="x">
          <span id="cb">B</span>
        </TabPanel>
        <TabPanel id="c" value="a" tabsId="x" keepMounted>
          <span id="cc">C</span>
        </TabPanel>
      </>,
    );
    expect(m.container.querySelector('#ca')).not.toBeNull();
    expect(m.container.querySelector('#cb')).toBeNull();
    expect(m.container.querySelector('#cc')).not.toBeNull();
    m.unmount();
  });
});
