import { describe, expect, it } from 'vitest';
import type { NodeChurn } from '../../../../api/generated/NodeChurn';
import { churnRow, churnRows, signed } from './churn';

const day: NodeChurn = { window: '24h', joined: 141, left: 38, complete: true };
const week: NodeChurn = { window: '7d', joined: 899, left: 279, complete: false };

describe('churnRow', () => {
  it('reads a complete window as a plain count', () => {
    const r = churnRow(day);
    expect(r.net).toBe(103);
    expect(r.note).toBeNull();
    expect(r.summary).toBe('In the last 24 hours, 141 nodes joined and 38 left, a net gain of 103.');
  });

  it('says "at least" for a window the server has not lived through, and where it counted from', () => {
    const r = churnRow(week);
    expect(r.complete).toBe(false);
    expect(r.note).toBe('since this server started, so the real figures are at least these');
    expect(r.summary).toBe(
      'In the last 7 days, at least 899 nodes joined and at least 279 left. The server has counted only since it started.',
    );
  });

  it('names a loss as a loss and no change as none', () => {
    expect(churnRow({ ...day, joined: 10, left: 25 }).summary).toContain('a net loss of 15');
    expect(churnRow({ ...day, joined: 7, left: 7 }).summary).toContain('no net change');
  });

  it('is grammatical for one node', () => {
    expect(churnRow({ ...day, joined: 1, left: 0 }).summary).toContain('1 node joined');
  });
});

describe('churnRows', () => {
  it('orders the windows 24 hours then 7 days whatever the server sent', () => {
    expect(churnRows([week, day]).map((r) => r.window)).toEqual(['24h', '7d']);
  });

  it('leaves out a window the server did not send, and handles no answer', () => {
    expect(churnRows([week]).map((r) => r.window)).toEqual(['7d']);
    expect(churnRows(undefined)).toEqual([]);
  });
});

describe('signed', () => {
  it('carries the sign in the text, so colour is never the only cue', () => {
    expect(signed(141)).toBe('+141');
    expect(signed(-38)).toBe('-38');
    expect(signed(0)).toBe('0');
  });
});
