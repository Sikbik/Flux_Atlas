// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../internal/testing';
import { HoverCard } from './HoverCard';
import { Tooltip } from './Tooltip';

function pointer(el: Element, type: 'pointerover' | 'pointerout', pointerType: string) {
  act(() => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'pointerType', { value: pointerType });
    el.dispatchEvent(ev);
  });
}

function pressEscape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
}

const layer = (role: string) => document.body.querySelector(`[role="${role}"]`);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Tooltip', () => {
  it('opens after a short mouse hover, names the trigger with aria-describedby, and closes on leave', () => {
    const m = mount(
      <Tooltip content="Pin to the dock">
        <button type="button">Pin</button>
      </Tooltip>,
    );
    const b = m.container.querySelector('button');
    expect(b).not.toBeNull();
    if (!b) return;
    pointer(b, 'pointerover', 'mouse');
    expect(layer('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const tip = layer('tooltip');
    expect(tip?.textContent).toBe('Pin to the dock');
    expect(b.getAttribute('aria-describedby')).toBe(tip?.id);
    pointer(b, 'pointerout', 'mouse');
    expect(layer('tooltip')).toBeNull();
    expect(b.hasAttribute('aria-describedby')).toBe(false);
    m.unmount();
  });

  it('does not open for touch input', () => {
    const m = mount(
      <Tooltip content="Nope">
        <button type="button">Touch</button>
      </Tooltip>,
    );
    const b = m.container.querySelector('button');
    if (b) pointer(b, 'pointerover', 'touch');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(layer('tooltip')).toBeNull();
    m.unmount();
  });

  it('closes on Escape and swallows it so the window underneath stays open', () => {
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    const m = mount(
      <Tooltip content="Hi" delay={0}>
        <button type="button">Hover</button>
      </Tooltip>,
    );
    const b = m.container.querySelector('button');
    if (b) pointer(b, 'pointerover', 'mouse');
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(layer('tooltip')).not.toBeNull();
    pressEscape();
    expect(layer('tooltip')).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outer);
    m.unmount();
  });

  it('stays closed when disabled', () => {
    const m = mount(
      <Tooltip content="Off" disabled>
        <button type="button">Hover</button>
      </Tooltip>,
    );
    const b = m.container.querySelector('button');
    if (b) pointer(b, 'pointerover', 'mouse');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(layer('tooltip')).toBeNull();
    m.unmount();
  });

  it('keeps the trigger own handlers and attributes', () => {
    const onFocus = vi.fn();
    const m = mount(
      <Tooltip content="x">
        <button type="button" aria-describedby="note" onFocus={onFocus}>
          Keep
        </button>
      </Tooltip>,
    );
    const b = m.container.querySelector('button');
    expect(b?.getAttribute('aria-describedby')).toBe('note');
    act(() => b?.focus());
    expect(onFocus).toHaveBeenCalled();
    m.unmount();
  });
});

describe('HoverCard', () => {
  it('opens after the hover delay as a labelled region and runs the lazy content only while open', () => {
    const content = vi.fn(() => <p>Preview body</p>);
    const m = mount(
      <HoverCard content={content} label="Node preview">
        <a href="/node/x">Node</a>
      </HoverCard>,
    );
    expect(content).not.toHaveBeenCalled();
    const a = m.container.querySelector('a');
    if (a) pointer(a, 'pointerover', 'mouse');
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(content).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(content).toHaveBeenCalled();
    expect(document.body.textContent).toContain('Preview body');
    m.unmount();
  });

  it('never opens for touch and closes on Escape', () => {
    const m = mount(
      <HoverCard content={<p>Body</p>} label="Preview">
        <a href="/x">Open node preview</a>
      </HoverCard>,
    );
    const a = m.container.querySelector('a');
    if (a) pointer(a, 'pointerover', 'touch');
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(document.body.textContent).not.toContain('Body');
    if (a) pointer(a, 'pointerover', 'mouse');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(document.body.textContent).toContain('Body');
    pressEscape();
    expect(document.body.textContent).not.toContain('Body');
    m.unmount();
  });
});
