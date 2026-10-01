import { describe, expect, it } from 'vitest';
import { notConfirmed } from './counts';

describe('notConfirmed', () => {
  it('names each group the summary sends, in the card order', () => {
    expect(notConfirmed({ node_count: 6700, started_count: 21, dos_count: 3, expired_count: 5 })).toEqual([
      ['Started, not confirmed', 21],
      ['On the DOS list', 3],
      ['Predicted expired', 5],
    ]);
  });

  it('keeps a real zero', () => {
    expect(notConfirmed({ started_count: 0, dos_count: 0, expired_count: 0 })).toHaveLength(3);
  });

  it('says nothing for a server that does not send them, rather than a zero', () => {
    expect(notConfirmed({ node_count: 6700 })).toEqual([]);
    expect(notConfirmed({ started_count: null, dos_count: 'x', expired_count: Number.NaN })).toEqual([]);
  });
});
