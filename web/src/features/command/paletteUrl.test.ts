import { describe, expect, it } from 'vitest';
import { decodeQValue, inheritedSearch, paletteTextFromSearch } from './paletteUrl';

describe('paletteTextFromSearch', () => {
  it('is null while q is absent (the palette is closed)', () => {
    expect(paletteTextFromSearch('')).toBeNull();
    expect(paletteTextFromSearch('?tier=stratus')).toBeNull();
  });

  it('reads an empty q as open with no text', () => {
    expect(paletteTextFromSearch('?q=')).toBe('');
    expect(paletteTextFromSearch('?tier=nimbus&q=')).toBe('');
  });

  it('reads the typed text, including the operator launcher text', () => {
    expect(paletteTextFromSearch('?q=65.109')).toBe('65.109');
    expect(paletteTextFromSearch('?q=operator+')).toBe('operator ');
    expect(paletteTextFromSearch('?q=operator%20')).toBe('operator ');
    expect(paletteTextFromSearch('?q=hetzner%20online')).toBe('hetzner online');
  });

  it('undoes the router JSON quoting of scalar-looking text', () => {
    expect(paletteTextFromSearch('?q=%2265.109%22')).toBe('65.109');
    expect(paletteTextFromSearch('?q=%222996914%22')).toBe('2996914');
  });
});

describe('decodeQValue', () => {
  it('keeps text that merely contains quotes', () => {
    expect(decodeQValue('say "hi"')).toBe('say "hi"');
    expect(decodeQValue('"')).toBe('"');
  });

  it('only unwraps a quoted JSON string', () => {
    expect(decodeQValue('"abc"')).toBe('abc');
    expect(decodeQValue('"12" ')).toBe('"12" ');
    expect(decodeQValue('"a"b"')).toBe('"a"b"');
  });
});

describe('inheritedSearch', () => {
  it('drops the palette text and the selection but keeps filters, layers and windows', () => {
    expect(inheritedSearch({ q: 'x', sel: 'a:1', tier: 'stratus', l: 'mesh.flow', w: 'queue' })).toEqual({
      tier: 'stratus',
      l: 'mesh.flow',
      w: 'queue',
    });
  });
});
