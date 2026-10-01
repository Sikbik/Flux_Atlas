// @vitest-environment jsdom
import { Server } from 'lucide-react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, mount, press } from '../internal/testing';
import { byRole, instantMotion, pointerDown, pointerMove } from '../popover/testUtils';
import { Select, type SelectOption } from './Select';
import { setValue } from './testUtils';

let restore: () => void;
beforeEach(() => {
  restore = instantMotion();
});
afterEach(() => {
  restore();
});

const options: SelectOption[] = [
  { value: 'ocean', label: 'Ocean', description: 'Public endpoint', icon: Server },
  { value: 'river', label: 'River' },
  { value: 'retired', label: 'Retired', disabled: true },
  { value: 'stream', label: 'Stream' },
];

const trigger = (root: HTMLElement) => root.querySelector('[role="combobox"]') as HTMLButtonElement;
const list = () => byRole('listbox')[0];
const rows = () => Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
const activeIndex = (root: HTMLElement) => {
  const id = trigger(root).getAttribute('aria-activedescendant');
  return rows().findIndex((r) => r.id === id);
};

describe('Select', () => {
  it('is a labelled combobox that starts closed and shows the placeholder', () => {
    const m = mount(<Select label="Provider" options={options} placeholder="Choose a provider" />);
    const t = trigger(m.container);
    expect(t.getAttribute('aria-haspopup')).toBe('listbox');
    expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(t.textContent).toContain('Choose a provider');
    expect(t.getAttribute('data-state')).toBe('closed');
    const label = m.container.querySelector('label');
    expect(label?.getAttribute('for')).toBe(t.id);
    expect(t.getAttribute('aria-labelledby')).toBe(label?.id);
    expect(list()).toBeUndefined();
    m.unmount();
  });

  it('opens on click with the chosen option highlighted and focus left on the trigger', () => {
    const m = mount(<Select aria-label="Provider" options={options} defaultValue="river" />);
    const t = trigger(m.container);
    t.focus();
    click(t);
    expect(list()).toBeDefined();
    expect(t.getAttribute('aria-expanded')).toBe('true');
    expect(t.getAttribute('aria-controls')).toBe(list()?.id);
    expect(t.getAttribute('data-state')).toBe('open');
    expect(rows()).toHaveLength(4);
    expect(rows()[1]?.getAttribute('aria-selected')).toBe('true');
    expect(rows()[1]?.getAttribute('data-state')).toBe('selected');
    expect(activeIndex(m.container)).toBe(1);
    expect(document.activeElement).toBe(t);
    m.unmount();
  });

  it('opens on the arrow keys: first option down, last option up', () => {
    const m = mount(<Select aria-label="Provider" options={options} />);
    press(trigger(m.container), 'ArrowDown');
    expect(activeIndex(m.container)).toBe(0);
    press(trigger(m.container), 'Escape');
    press(trigger(m.container), 'ArrowUp');
    expect(activeIndex(m.container)).toBe(3);
    m.unmount();
  });

  it('moves the highlight past disabled options without wrapping, and chooses with Enter', () => {
    const onChange = vi.fn();
    const m = mount(<Select aria-label="Provider" options={options} onChange={onChange} />);
    const t = trigger(m.container);
    press(t, 'ArrowDown');
    press(t, 'ArrowDown');
    expect(activeIndex(m.container)).toBe(1);
    press(t, 'ArrowDown');
    expect(activeIndex(m.container)).toBe(3);
    press(t, 'ArrowDown');
    expect(activeIndex(m.container)).toBe(3);
    press(t, 'Home');
    expect(activeIndex(m.container)).toBe(0);
    press(t, 'End');
    expect(activeIndex(m.container)).toBe(3);
    press(t, 'Enter');
    expect(onChange).toHaveBeenCalledWith('stream');
    expect(list()).toBeUndefined();
    expect(t.textContent).toContain('Stream');
    m.unmount();
  });

  it('closes on Escape without changing the value', () => {
    const onChange = vi.fn();
    const m = mount(
      <Select aria-label="Provider" options={options} defaultValue="ocean" onChange={onChange} />,
    );
    const t = trigger(m.container);
    press(t, 'ArrowDown');
    press(t, 'ArrowDown');
    press(t, 'Escape');
    expect(list()).toBeUndefined();
    expect(onChange).not.toHaveBeenCalled();
    expect(t.textContent).toContain('Ocean');
    m.unmount();
  });

  it('jumps to a typed label, opening the list from the closed trigger', () => {
    const m = mount(<Select aria-label="Provider" options={options} />);
    const t = trigger(m.container);
    press(t, 's');
    expect(list()).toBeDefined();
    expect(activeIndex(m.container)).toBe(3);
    press(t, 'Escape');
    m.unmount();

    const again = mount(<Select aria-label="Provider" options={options} defaultValue="stream" />);
    press(trigger(again.container), 'o');
    expect(activeIndex(again.container)).toBe(0);
    again.unmount();
  });

  it('chooses with a pointer and highlights under the pointer', () => {
    const onChange = vi.fn();
    const m = mount(<Select aria-label="Provider" options={options} onChange={onChange} />);
    click(trigger(m.container));
    pointerMove(rows()[3] as HTMLElement);
    expect(activeIndex(m.container)).toBe(3);
    pointerMove(rows()[2] as HTMLElement);
    expect(activeIndex(m.container)).toBe(3);
    click(rows()[3] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('stream');
    expect(list()).toBeUndefined();
    m.unmount();
  });

  it('does not choose a disabled option', () => {
    const onChange = vi.fn();
    const m = mount(<Select aria-label="Provider" options={options} onChange={onChange} />);
    click(trigger(m.container));
    click(rows()[2] as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();
    expect(list()).toBeDefined();
    expect(rows()[2]?.getAttribute('aria-disabled')).toBe('true');
    m.unmount();
  });

  it('follows a controlled value and reports a pick without changing it itself', () => {
    const onChange = vi.fn();
    const m = mount(<Select aria-label="Provider" options={options} value="river" onChange={onChange} />);
    const t = trigger(m.container);
    expect(t.textContent).toContain('River');
    click(t);
    click(rows()[3] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('stream');
    expect(t.textContent).toContain('River');
    m.rerender(<Select aria-label="Provider" options={options} value="stream" onChange={onChange} />);
    expect(trigger(m.container).textContent).toContain('Stream');
    m.unmount();
  });

  it('does not report picking the value it already has', () => {
    const onChange = vi.fn();
    const m = mount(
      <Select aria-label="Provider" options={options} defaultValue="river" onChange={onChange} />,
    );
    click(trigger(m.container));
    click(rows()[1] as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();
    expect(list()).toBeUndefined();
    m.unmount();
  });

  it('chooses the highlighted option on Tab and lets focus move on', () => {
    const onChange = vi.fn();
    const m = mount(<Select aria-label="Provider" options={options} onChange={onChange} />);
    const t = trigger(m.container);
    press(t, 'ArrowDown');
    press(t, 'ArrowDown');
    press(t, 'Tab');
    expect(onChange).toHaveBeenCalledWith('river');
    expect(list()).toBeUndefined();
    m.unmount();
  });

  it('can be controlled open, for specimens', () => {
    const m = mount(<Select aria-label="Provider" options={options} open onOpenChange={() => {}} />);
    expect(list()).toBeDefined();
    expect(trigger(m.container).getAttribute('data-state')).toBe('open');
    m.unmount();
  });

  it('closes on a press outside', () => {
    const m = mount(<Select aria-label="Provider" options={options} />);
    click(trigger(m.container));
    pointerDown(document.body);
    expect(list()).toBeUndefined();
    m.unmount();
  });

  it('does not open while disabled', () => {
    const m = mount(<Select aria-label="Provider" options={options} disabled />);
    const t = trigger(m.container);
    press(t, 'ArrowDown');
    click(t);
    expect(list()).toBeUndefined();
    expect(t.disabled).toBe(true);
    m.unmount();
  });

  it('shows an error in place of the hint and marks the trigger invalid', () => {
    const m = mount(<Select label="Provider" options={options} hint="Pick one" error="Choose a provider" />);
    const t = trigger(m.container);
    expect(t.getAttribute('aria-invalid')).toBe('true');
    expect(t.getAttribute('data-invalid')).toBe('true');
    expect(m.container.textContent).toContain('Choose a provider');
    expect(m.container.textContent).not.toContain('Pick one');
    expect(t.getAttribute('aria-describedby')).toContain('error');
    m.unmount();
  });

  it('shows a busy state while loading', () => {
    const m = mount(<Select aria-label="Provider" options={[]} loading />);
    const t = trigger(m.container);
    expect(t.getAttribute('data-state')).toBe('loading');
    expect(t.getAttribute('aria-busy')).toBe('true');
    m.unmount();
  });

  it('says so when there are no options', () => {
    const m = mount(<Select aria-label="Provider" options={[]} emptyText="No providers yet" />);
    click(trigger(m.container));
    expect(list()?.textContent).toContain('No providers yet');
    m.unmount();
  });

  it('marks a press with data-pressed on the trigger', () => {
    const m = mount(<Select aria-label="Provider" options={options} />);
    const t = trigger(m.container);
    act(() => {
      t.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    });
    expect(t.hasAttribute('data-pressed')).toBe(true);
    act(() => {
      t.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    });
    expect(t.hasAttribute('data-pressed')).toBe(false);
    m.unmount();
  });

  it('puts className and style on the frame and the ref on the trigger', () => {
    let node: HTMLElement | null = null;
    const m = mount(
      <Select
        aria-label="Provider"
        options={options}
        className="extra"
        style={{ width: 200 }}
        ref={(el) => {
          node = el;
        }}
      />,
    );
    const frame = m.container.querySelector('.ui-field') as HTMLElement;
    expect(frame.classList.contains('extra')).toBe(true);
    expect(frame.style.width).toBe('200px');
    expect(node).toBe(trigger(m.container));
    m.unmount();
  });
});

describe('Select native', () => {
  it('renders a styled native select with a placeholder option until chosen', () => {
    const onChange = vi.fn();
    const m = mount(
      <Select native label="Provider" options={options} placeholder="Choose" onChange={onChange} />,
    );
    const el = m.container.querySelector('select') as HTMLSelectElement;
    expect(el).not.toBeNull();
    expect(el.value).toBe('');
    expect(el.options[0]?.textContent).toBe('Choose');
    expect(el.options[0]?.disabled).toBe(true);
    expect(m.container.querySelector('label')?.getAttribute('for')).toBe(el.id);
    setValue(el, 'river');
    expect(onChange).toHaveBeenCalledWith('river');
    expect(el.value).toBe('river');
    expect(el.options[0]?.textContent).toBe('Ocean');
    m.unmount();
  });

  it('disables options and the whole control', () => {
    const m = mount(<Select native aria-label="Provider" options={options} defaultValue="river" disabled />);
    const el = m.container.querySelector('select') as HTMLSelectElement;
    expect(el.disabled).toBe(true);
    expect(Array.from(el.options).find((o) => o.value === 'retired')?.disabled).toBe(true);
    m.unmount();
  });
});
