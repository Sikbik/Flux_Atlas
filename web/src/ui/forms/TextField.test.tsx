// @vitest-environment jsdom
import { Search } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '../internal/testing';
import { TextField } from './TextField';
import { mouseDown, setValue } from './testUtils';

const input = (root: HTMLElement) => root.querySelector('input') as HTMLInputElement;

describe('TextField', () => {
  it('links the visible label to the input', () => {
    const m = mount(<TextField label="Payment address" />);
    const label = m.container.querySelector('label');
    expect(label?.textContent).toBe('Payment address');
    expect(label?.getAttribute('for')).toBe(input(m.container).id);
    m.unmount();
  });

  it('describes the input with the hint, and replaces the hint with the error', () => {
    const m = mount(<TextField label="Address" hint="Starts with t1" />);
    const el = input(m.container);
    const hint = m.container.querySelector('.ui-field__msg');
    expect(hint?.textContent).toBe('Starts with t1');
    expect(el.getAttribute('aria-describedby')).toBe(hint?.id);
    expect(el.hasAttribute('aria-invalid')).toBe(false);

    m.rerender(<TextField label="Address" hint="Starts with t1" error="Not an address" />);
    const msg = m.container.querySelector('.ui-field__msg');
    expect(msg?.textContent).toBe('Not an address');
    expect(msg?.getAttribute('data-kind')).toBe('error');
    expect(input(m.container).getAttribute('aria-invalid')).toBe('true');
    expect(input(m.container).getAttribute('aria-describedby')).toBe(msg?.id);
    expect(m.container.querySelectorAll('.ui-field__msg').length).toBe(1);
    m.unmount();
  });

  it('keeps one message line in the layout once a hint is in play, and on request', () => {
    const none = mount(<TextField label="A" />);
    expect(none.container.querySelector('.ui-field__foot')).toBeNull();
    none.unmount();

    const reserved = mount(<TextField label="A" reserveMessage />);
    expect(reserved.container.querySelector('.ui-field__foot')).not.toBeNull();
    expect(reserved.container.querySelector('.ui-field__msg')).toBeNull();
    reserved.unmount();
  });

  it('merges an extra aria-describedby', () => {
    const m = mount(<TextField label="A" hint="h" aria-describedby="extra" />);
    const ids = (input(m.container).getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe('extra');
    m.unmount();
  });

  it('works uncontrolled and reports changes', () => {
    const onValueChange = vi.fn();
    const onChange = vi.fn();
    const m = mount(
      <TextField aria-label="x" defaultValue="abc" onValueChange={onValueChange} onChange={onChange} />,
    );
    expect(input(m.container).value).toBe('abc');
    setValue(input(m.container), 'abcd');
    expect(input(m.container).value).toBe('abcd');
    expect(onValueChange).toHaveBeenCalledWith('abcd');
    expect(onChange).toHaveBeenCalledTimes(1);
    m.unmount();
  });

  it('works controlled', () => {
    function Controlled() {
      const [v, setV] = useState('t1');
      return <TextField aria-label="x" value={v} onValueChange={(next) => setV(next.toUpperCase())} />;
    }
    const m = mount(<Controlled />);
    setValue(input(m.container), 'ab');
    expect(input(m.container).value).toBe('AB');
    m.unmount();
  });

  it('marks data inputs as mono without spellcheck', () => {
    const m = mount(<TextField aria-label="x" mono />);
    expect(m.container.querySelector('.ui-field__box')?.hasAttribute('data-mono')).toBe(true);
    expect(input(m.container).getAttribute('spellcheck')).toBe('false');
    m.unmount();
  });

  it('renders the icon, prefix, suffix, trailing slot and key caps', () => {
    const m = mount(
      <TextField
        aria-label="x"
        icon={Search}
        prefix="https://"
        suffix="ms"
        trailing={<span data-testid="t">T</span>}
        kbd={['ctrl', 'K']}
      />,
    );
    const box = m.container.querySelector('.ui-field__box') as HTMLElement;
    expect(box.querySelector('svg.ui-field__icon')).not.toBeNull();
    const affixes = Array.from(box.querySelectorAll('.ui-field__affix')).map((a) => a.textContent);
    expect(affixes).toEqual(['https://', 'ms']);
    expect(box.querySelector('[data-testid="t"]')).not.toBeNull();
    expect(Array.from(box.querySelectorAll('kbd')).map((k) => k.textContent)).toEqual(['ctrl', 'K']);
    m.unmount();
  });

  it('flags disabled and read-only on the box and the input', () => {
    const m = mount(<TextField aria-label="x" disabled readOnly />);
    const box = m.container.querySelector('.ui-field__box');
    expect(input(m.container).disabled).toBe(true);
    expect(input(m.container).readOnly).toBe(true);
    expect(box?.hasAttribute('data-disabled')).toBe(true);
    expect(box?.hasAttribute('data-readonly')).toBe(true);
    m.unmount();
  });

  it('focuses the input when the box padding is pressed', () => {
    const m = mount(<TextField aria-label="x" icon={Search} />);
    mouseDown(m.container.querySelector('.ui-field__box') as HTMLElement);
    expect(document.activeElement).toBe(input(m.container));
    m.unmount();
  });
});
