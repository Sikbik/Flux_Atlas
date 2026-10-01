// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyKey, drainTypeAhead, startTypeAhead, TYPE_AHEAD_MS } from './typeAhead';

const key = (k: string, extra: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });

describe('applyKey', () => {
  const base = { ctrlKey: false, metaKey: false, altKey: false, isComposing: false };

  it('appends a character and drops one on Backspace', () => {
    expect(applyKey('g', { ...base, key: 'm' })).toBe('gm');
    expect(applyKey('gm', { ...base, key: 'Backspace' })).toBe('g');
    expect(applyKey('', { ...base, key: 'Backspace' })).toBe('');
    expect(applyKey('', { ...base, key: 'é' })).toBe('é');
  });

  it('leaves everything that is not text alone', () => {
    for (const k of ['Enter', 'Tab', 'ArrowDown', 'Shift', 'Escape', 'F5', 'Dead']) {
      expect(applyKey('x', { ...base, key: k })).toBeNull();
    }
    expect(applyKey('x', { ...base, key: 'v', ctrlKey: true })).toBeNull();
    expect(applyKey('x', { ...base, key: 'v', metaKey: true })).toBeNull();
    expect(applyKey('x', { ...base, key: 'a', altKey: true })).toBeNull();
    expect(applyKey('x', { ...base, key: 'a', isComposing: true })).toBeNull();
  });
});

describe('the buffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    drainTypeAhead();
    vi.useRealTimers();
  });

  it('keeps what is typed before the field exists, once, and keeps the page from seeing it', () => {
    startTypeAhead();
    const a = key('g');
    document.body.dispatchEvent(a);
    document.body.dispatchEvent(key('m'));
    document.body.dispatchEvent(key('x'));
    document.body.dispatchEvent(key('Backspace'));
    expect(a.defaultPrevented).toBe(true);
    expect(drainTypeAhead()).toBe('gm');
    expect(drainTypeAhead()).toBe('');
  });

  it('lets shortcuts and navigation keys through', () => {
    startTypeAhead();
    const enter = key('Enter');
    const paste = key('v', { ctrlKey: true });
    document.body.dispatchEvent(enter);
    document.body.dispatchEvent(paste);
    expect(enter.defaultPrevented).toBe(false);
    expect(paste.defaultPrevented).toBe(false);
    expect(drainTypeAhead()).toBe('');
  });

  it('stops listening once the palette has the keyboard, and still hands over what it kept', () => {
    document.body.innerHTML = '<div class="pal-layer"><input id="f"></div>';
    startTypeAhead();
    document.body.dispatchEvent(key('g'));
    const own = key('m');
    document.getElementById('f')?.dispatchEvent(own);
    expect(own.defaultPrevented).toBe(false);
    document.body.dispatchEvent(key('x'));
    expect(drainTypeAhead()).toBe('g');
  });

  it('is cancelled by Escape', () => {
    startTypeAhead();
    document.body.dispatchEvent(key('g'));
    document.body.dispatchEvent(key('Escape'));
    expect(drainTypeAhead()).toBe('');
  });

  it('drops a buffer nobody took, and starts clean the next time', () => {
    startTypeAhead();
    document.body.dispatchEvent(key('g'));
    vi.advanceTimersByTime(TYPE_AHEAD_MS + 1);
    expect(drainTypeAhead()).toBe('');

    startTypeAhead();
    document.body.dispatchEvent(key('a'));
    startTypeAhead();
    document.body.dispatchEvent(key('b'));
    expect(drainTypeAhead()).toBe('b');
  });
});
