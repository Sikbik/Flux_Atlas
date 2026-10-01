import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, describeGroup, groupAlerts, parsePrefs, type WatchAlert } from './model';

const alert = (kind: WatchAlert['kind'], id: number, over: Partial<WatchAlert> = {}): WatchAlert => ({
  kind,
  id,
  detail: null,
  endpoint: `10.0.0.${id}:16127`,
  ...over,
});

describe('parsePrefs', () => {
  it('falls back to the defaults for anything unexpected', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('x')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ notify: 'yes', kinds: 3 })).toEqual(DEFAULT_PREFS);
  });

  it('keeps valid values and fills the rest', () => {
    const p = parsePrefs({ notify: true, kinds: { paid: false, offline: 'no' } });
    expect(p.notify).toBe(true);
    expect(p.kinds.paid).toBe(false);
    expect(p.kinds.offline).toBe(true);
    expect(p.kinds.expired).toBe(true);
  });

  it('does not share the default object', () => {
    const p = parsePrefs(undefined);
    p.kinds.paid = false;
    expect(DEFAULT_PREFS.kinds.paid).toBe(true);
  });
});

describe('groupAlerts', () => {
  it('groups by kind in severity order and drops the kinds that are off', () => {
    const groups = groupAlerts(
      [alert('paid', 1), alert('offline', 2), alert('paid', 3), alert('expired', 4), alert('at_risk', 5)],
      { ...DEFAULT_PREFS.kinds, at_risk: false },
    );
    expect(groups.map((g) => [g.kind, g.alerts.length])).toEqual([
      ['expired', 1],
      ['offline', 1],
      ['paid', 2],
    ]);
  });
});

describe('describeGroup', () => {
  it('describes a single alert and opens the node', () => {
    const t = describeGroup({ kind: 'offline', alerts: [alert('offline', 1)] });
    expect(t.title).toBe('Node unreachable');
    expect(t.body).toBe('10.0.0.1:16127 can no longer be reached.');
    expect(t.to).toBe('/node/10.0.0.1%3A16127');
  });

  it('puts the numbers in the sentence', () => {
    expect(describeGroup({ kind: 'at_risk', alerts: [alert('at_risk', 1, { detail: 575 })] }).body).toContain(
      '575 blocks',
    );
    expect(describeGroup({ kind: 'paid', alerts: [alert('paid', 1, { detail: 2_997_001 })] }).body).toContain(
      '2,997,001',
    );
    expect(
      describeGroup({
        kind: 'ip_changed',
        alerts: [alert('ip_changed', 1, { endpoint: '9.9.9.9:16127', from: '8.8.8.8:16127' })],
      }).body,
    ).toBe('8.8.8.8:16127 is now announced at 9.9.9.9:16127.');
  });

  it('merges a burst into one message that opens the watchlist', () => {
    const alerts = [1, 2, 3, 4, 5].map((i) => alert('offline', i));
    const t = describeGroup({ kind: 'offline', alerts });
    expect(t.title).toBe('5 watched nodes unreachable');
    expect(t.body).toBe('10.0.0.1:16127, 10.0.0.2:16127, 10.0.0.3:16127 and 2 more');
    expect(t.to).toBe('/operator/watchlist');
  });

  it('never uses an emoji or an ellipsis character', () => {
    const kinds = ['offline', 'at_risk', 'paid', 'ip_changed', 'expired'] as const;
    for (const kind of kinds) {
      for (const n of [1, 4]) {
        const t = describeGroup({ kind, alerts: Array.from({ length: n }, (_, i) => alert(kind, i + 1)) });
        expect(`${t.title} ${t.body}`).toMatch(/^[\x20-\x7e]+$/);
      }
    }
  });
});
