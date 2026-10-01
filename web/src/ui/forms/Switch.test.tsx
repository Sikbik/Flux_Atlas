// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { click, flush, mount } from '../internal/testing';
import { Switch } from './Switch';

const input = (root: HTMLElement) => root.querySelector('input') as HTMLInputElement;

describe('Switch', () => {
  it('is a labelled switch that starts off', () => {
    const m = mount(<Switch label="Reveal peers on the globe" />);
    const el = input(m.container);
    expect(el.getAttribute('role')).toBe('switch');
    expect(el.type).toBe('checkbox');
    expect(el.checked).toBe(false);
    expect(m.container.querySelector('label')?.textContent).toContain('Reveal peers on the globe');
    m.unmount();
  });

  it('toggles when the label is pressed and reports the new state', () => {
    const onChange = vi.fn();
    const m = mount(<Switch label="Peers" onChange={onChange} />);
    click(m.container.querySelector('.ui-switch__text') as HTMLElement);
    expect(input(m.container).checked).toBe(true);
    expect(onChange.mock.calls[0]?.[0]).toBe(true);
    click(m.container.querySelector('.ui-switch__text') as HTMLElement);
    expect(onChange.mock.calls[1]?.[0]).toBe(false);
    m.unmount();
  });

  it('starts on with defaultChecked', () => {
    const m = mount(<Switch aria-label="x" defaultChecked />);
    expect(input(m.container).checked).toBe(true);
    m.unmount();
  });

  it('follows the checked prop when controlled', () => {
    function Controlled() {
      const [on, setOn] = useState(false);
      return <Switch aria-label="x" checked={on} onChange={setOn} />;
    }
    const m = mount(<Controlled />);
    click(input(m.container));
    expect(input(m.container).checked).toBe(true);
    m.unmount();

    // Controlled and not followed: stays off.
    const stuck = mount(<Switch aria-label="x" checked={false} onChange={() => {}} />);
    click(input(stuck.container));
    expect(input(stuck.container).checked).toBe(false);
    stuck.unmount();
  });

  it('does not toggle when disabled', () => {
    const onChange = vi.fn();
    const m = mount(<Switch aria-label="x" disabled onChange={onChange} />);
    // A real press on a disabled control does nothing; HTMLElement.click() models that.
    flush(() => input(m.container).click());
    expect(onChange).not.toHaveBeenCalled();
    expect(input(m.container).checked).toBe(false);
    expect(m.container.querySelector('.ui-switch')?.hasAttribute('data-disabled')).toBe(true);
    m.unmount();
  });

  it('describes the switch with its description', () => {
    const m = mount(<Switch label="Weather" description="Show degraded regions as haze" />);
    const desc = m.container.querySelector('.ui-switch__desc');
    expect(desc?.textContent).toBe('Show degraded regions as haze');
    expect(input(m.container).getAttribute('aria-describedby')).toBe(desc?.id);
    m.unmount();
  });

  it('supports the settings-row layout', () => {
    const m = mount(<Switch label="Ambient mode" layout="row" />);
    expect(m.container.querySelector('.ui-switch')?.getAttribute('data-layout')).toBe('row');
    m.unmount();
  });
});
