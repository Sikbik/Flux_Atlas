import { describe, expect, it } from 'vitest';
import { anyUnknownSize, txSizeText } from './txsize';

describe('txSizeText', () => {
  it('names an unknown size instead of showing a number', () => {
    expect(txSizeText(null)).toBe('Size unknown');
  });
  it('formats a known size', () => {
    expect(txSizeText(226)).toMatch(/226/);
  });
});

describe('anyUnknownSize', () => {
  it('is true when any size is unknown', () => {
    expect(anyUnknownSize([226, null, 400])).toBe(true);
  });
  it('is false when every size is known, or there are none', () => {
    expect(anyUnknownSize([226, 400])).toBe(false);
    expect(anyUnknownSize([])).toBe(false);
  });
});
