import { describe, expect, it } from 'vitest';
import { text, validateGlobalSearch } from './search';

describe('the palette text (q)', () => {
  it('keeps a prefix with its space, so a launcher can open the palette on a kind', () => {
    expect(validateGlobalSearch({ q: 'app ' }).q).toBe('app ');
    expect(validateGlobalSearch({ q: 'operator ' }).q).toBe('operator ');
    expect(validateGlobalSearch({ q: 'app fluxnode ' }).q).toBe('app fluxnode ');
  });

  it('clears the space before the text and drops an empty or blank one', () => {
    expect(validateGlobalSearch({ q: '  hetzner' }).q).toBe('hetzner');
    expect(validateGlobalSearch({ q: '' })).not.toHaveProperty('q');
    expect(validateGlobalSearch({ q: '   ' })).not.toHaveProperty('q');
  });

  it('turns a number the router parsed back into text, and drops other types and runaway text', () => {
    expect(text(65109)).toBe('65109');
    expect(text(true)).toBeUndefined();
    expect(text('x'.repeat(513))).toBeUndefined();
  });

  it('leaves every other parameter trimmed as before', () => {
    expect(validateGlobalSearch({ org: ' hetzner ', w: ' queue ' })).toEqual({ org: 'hetzner', w: 'queue' });
  });
});
