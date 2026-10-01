// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, mount, press } from '../internal/testing';
import { SearchField } from './SearchField';
import { setValue } from './testUtils';

const input = (root: HTMLElement) => root.querySelector('input') as HTMLInputElement;
const clearButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.ui-field__clear');

describe('SearchField', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is a search landmark around a search input', () => {
    const m = mount(<SearchField aria-label="Search nodes" />);
    const landmark = m.container.querySelector('[role="search"]');
    expect(landmark?.getAttribute('aria-label')).toBe('Search nodes');
    expect(input(m.container).type).toBe('search');
    expect(input(m.container).getAttribute('aria-label')).toBe('Search nodes');
    m.unmount();
  });

  it('shows the clear button only while there is text, and clearing refocuses the input', () => {
    const onValueChange = vi.fn();
    const m = mount(<SearchField onValueChange={onValueChange} />);
    expect(clearButton(m.container)).toBeNull();
    setValue(input(m.container), 'helsinki');
    expect(clearButton(m.container)).not.toBeNull();
    expect(clearButton(m.container)?.getAttribute('aria-label')).toBe('Clear search');
    click(clearButton(m.container) as HTMLElement);
    expect(input(m.container).value).toBe('');
    expect(onValueChange).toHaveBeenLastCalledWith('');
    expect(clearButton(m.container)).toBeNull();
    expect(document.activeElement).toBe(input(m.container));
    m.unmount();
  });

  it('clears on Escape and keeps the key from reaching the window while there is text', () => {
    const outer = vi.fn();
    const m = mount(
      // biome-ignore lint/a11y/noStaticElementInteractions: a test listener standing in for the shell's Escape handling
      <div onKeyDown={outer}>
        <SearchField defaultValue="abc" />
      </div>,
    );
    press(input(m.container), 'Escape');
    expect(input(m.container).value).toBe('');
    expect(outer).not.toHaveBeenCalled();
    m.unmount();
  });

  it('lets Escape through when the field is empty', () => {
    const outer = vi.fn();
    const m = mount(
      // biome-ignore lint/a11y/noStaticElementInteractions: a test listener standing in for the shell's Escape handling
      <div onKeyDown={outer}>
        <SearchField />
      </div>,
    );
    press(input(m.container), 'Escape');
    expect(outer).toHaveBeenCalledTimes(1);
    m.unmount();
  });

  it('submits on Enter with the current text', () => {
    const onSubmit = vi.fn();
    const m = mount(<SearchField defaultValue="2996914" onSubmit={onSubmit} />);
    press(input(m.container), 'Enter');
    expect(onSubmit).toHaveBeenCalledWith('2996914');
    m.unmount();
  });

  it('debounces typing, flushes on Enter and on clear', () => {
    const onDebouncedChange = vi.fn();
    const m = mount(<SearchField onDebouncedChange={onDebouncedChange} delayMs={300} />);
    setValue(input(m.container), 'h');
    setValue(input(m.container), 'he');
    setValue(input(m.container), 'hel');
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onDebouncedChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(onDebouncedChange).toHaveBeenCalledTimes(1);
    expect(onDebouncedChange).toHaveBeenLastCalledWith('hel');

    setValue(input(m.container), 'helsinki');
    press(input(m.container), 'Enter');
    expect(onDebouncedChange).toHaveBeenLastCalledWith('helsinki');
    expect(onDebouncedChange).toHaveBeenCalledTimes(2);

    setValue(input(m.container), 'x');
    click(clearButton(m.container) as HTMLElement);
    expect(onDebouncedChange).toHaveBeenLastCalledWith('');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDebouncedChange).toHaveBeenCalledTimes(3);
    m.unmount();
  });

  it('drops a pending debounced call on unmount', () => {
    const onDebouncedChange = vi.fn();
    const m = mount(<SearchField onDebouncedChange={onDebouncedChange} />);
    setValue(input(m.container), 'abc');
    m.unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDebouncedChange).not.toHaveBeenCalled();
  });

  it('works controlled', () => {
    function Controlled() {
      const [v, setV] = useState('node');
      return <SearchField value={v} onValueChange={setV} />;
    }
    const m = mount(<Controlled />);
    expect(input(m.container).value).toBe('node');
    click(clearButton(m.container) as HTMLElement);
    expect(input(m.container).value).toBe('');
    m.unmount();
  });

  it('shows a spinner and aria-busy while loading', () => {
    const m = mount(<SearchField loading />);
    expect(m.container.querySelector('.ui-field__spin')).not.toBeNull();
    expect(m.container.querySelector('[role="search"]')?.getAttribute('aria-busy')).toBe('true');
    m.unmount();
  });
});
