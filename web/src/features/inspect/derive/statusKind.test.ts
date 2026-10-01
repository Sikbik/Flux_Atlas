import { describe, expect, it } from 'vitest';
import { isQuietKind, nodeStatusKind } from './statusKind';

describe('nodeStatusKind', () => {
  it('reads a confirmed, reachable, checking-in node as confirmed', () => {
    expect(nodeStatusKind({ status: 'confirmed', reachable: true, sinceConfirm: 100 })).toBe('confirmed');
    expect(nodeStatusKind({ status: 'confirmed', reachable: null, sinceConfirm: null })).toBe('confirmed');
  });

  it('sharpens a confirmed node by its check-in age', () => {
    expect(nodeStatusKind({ status: 'confirmed', reachable: true, sinceConfirm: 560 })).toBe('at-risk');
    expect(nodeStatusKind({ status: 'confirmed', reachable: true, sinceConfirm: 640 })).toBe('expired');
  });

  it('names an offline or unreachable node, past expiry first', () => {
    expect(nodeStatusKind({ status: 'offline', reachable: true, sinceConfirm: 10 })).toBe('offline');
    expect(nodeStatusKind({ status: 'confirmed', reachable: false, sinceConfirm: 10 })).toBe('unreachable');
    expect(nodeStatusKind({ status: 'offline', reachable: false, sinceConfirm: 700 })).toBe('expired');
  });

  it('never draws a started, listed or departed node as confirmed', () => {
    expect(nodeStatusKind({ status: 'started', reachable: true, sinceConfirm: 0 })).toBe('started');
    expect(nodeStatusKind({ status: 'dos', reachable: true, sinceConfirm: 0 })).toBe('dos');
    expect(nodeStatusKind({ status: 'departed', reachable: null, sinceConfirm: null })).toBe('departed');
    expect(nodeStatusKind({ status: 'unknown', reachable: null, sinceConfirm: null })).toBe('unknown');
  });

  it('calls only a confirmed node quiet', () => {
    expect(isQuietKind('confirmed')).toBe(true);
    expect(isQuietKind('unreachable')).toBe(false);
  });
});
