import { describe, expect, it } from 'vitest';
import { isTypeaheadKey, nextTypeahead, TYPEAHEAD_RESET_MS, typeaheadActive } from './typeahead';

const none = { ctrlKey: false, metaKey: false, altKey: false };

describe('nextTypeahead', () => {
  it('appends keys typed in quick succession', () => {
    let s = { buffer: '', at: 0 };
    s = nextTypeahead(s, 'B', 1000);
    s = nextTypeahead(s, 'r', 1200);
    expect(s).toEqual({ buffer: 'br', at: 1200 });
  });

  it('starts over after a pause', () => {
    const s = nextTypeahead({ buffer: 'br', at: 1000 }, 'n', 1000 + TYPEAHEAD_RESET_MS + 1);
    expect(s.buffer).toBe('n');
  });
});

describe('typeaheadActive', () => {
  it('is true only while a prefix is fresh', () => {
    expect(typeaheadActive({ buffer: '', at: 0 }, 10)).toBe(false);
    expect(typeaheadActive({ buffer: 'a', at: 0 }, 100)).toBe(true);
    expect(typeaheadActive({ buffer: 'a', at: 0 }, TYPEAHEAD_RESET_MS + 1)).toBe(false);
  });
});

describe('isTypeaheadKey', () => {
  it('accepts single characters and rejects shortcuts and named keys', () => {
    expect(isTypeaheadKey({ key: 'a', ...none })).toBe(true);
    expect(isTypeaheadKey({ key: '7', ...none })).toBe(true);
    expect(isTypeaheadKey({ key: 'a', ...none, ctrlKey: true })).toBe(false);
    expect(isTypeaheadKey({ key: 'a', ...none, metaKey: true })).toBe(false);
    expect(isTypeaheadKey({ key: 'Enter', ...none })).toBe(false);
    expect(isTypeaheadKey({ key: 'ArrowDown', ...none })).toBe(false);
  });
});
