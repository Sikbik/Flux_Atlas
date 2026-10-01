import { describe, expect, it } from 'vitest';
import { formatDelta } from './delta';

describe('formatDelta', () => {
  it('signs counts and groups thousands', () => {
    expect(formatDelta(23)).toEqual({ text: '+23', direction: 'up' });
    expect(formatDelta(-1204)).toEqual({ text: '-1,204', direction: 'down' });
  });

  it('formats percentages with two decimals by default', () => {
    expect(formatDelta(1.95, { kind: 'percent' })).toEqual({ text: '+1.95%', direction: 'up' });
    expect(formatDelta(-0.5, { kind: 'percent' })).toEqual({ text: '-0.50%', direction: 'down' });
    expect(formatDelta(2.13, { kind: 'percent', decimals: 1 })).toEqual({ text: '+2.1%', direction: 'up' });
  });

  it('treats a change that rounds to zero as flat, without a sign', () => {
    expect(formatDelta(0)).toEqual({ text: '0', direction: 'flat' });
    expect(formatDelta(0.004, { kind: 'percent' })).toEqual({ text: '0.00%', direction: 'flat' });
    expect(formatDelta(-0.2)).toEqual({ text: '0', direction: 'flat' });
  });
});
