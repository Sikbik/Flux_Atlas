import { describe, expect, it } from 'vitest';
import { columnTrack, gridTemplate, minTableWidth, resolveRowHeight } from './layout';

describe('column geometry', () => {
  it('makes flexible columns by default and honours min widths', () => {
    expect(columnTrack({})).toBe('minmax(96px, 1fr)');
    expect(columnTrack({ minWidth: 140 })).toBe('minmax(140px, 1fr)');
  });

  it('turns numbers into px and fr strings into weighted flexible tracks', () => {
    expect(columnTrack({ width: 72 })).toBe('72px');
    expect(columnTrack({ width: '2fr', minWidth: 120 })).toBe('minmax(120px, 2fr)');
    expect(columnTrack({ width: '1.5fr' })).toBe('minmax(96px, 1.5fr)');
    expect(columnTrack({ width: '18ch' })).toBe('18ch');
  });

  it('builds the template and the horizontal-scroll threshold', () => {
    const cols = [{ width: 80 }, { minWidth: 120 }, {}];
    expect(gridTemplate(cols)).toBe('80px minmax(120px, 1fr) minmax(96px, 1fr)');
    expect(minTableWidth(cols)).toBe(80 + 120 + 96);
  });
});

describe('resolveRowHeight', () => {
  it('defaults to 34, compact is 28, touch raises to 40', () => {
    expect(resolveRowHeight(undefined, false)).toBe(34);
    expect(resolveRowHeight('compact', false)).toBe(28);
    expect(resolveRowHeight(30, false)).toBe(30);
    expect(resolveRowHeight(34, true)).toBe(40);
    expect(resolveRowHeight(48, true)).toBe(48);
  });
});
