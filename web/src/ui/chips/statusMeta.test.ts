import { describe, expect, it } from 'vitest';
import { STATUS_META, type StatusKind, statusMeta } from './statusMeta';

describe('statusMeta', () => {
  it('maps every API NodeStatus to a role, a word and an icon', () => {
    const fromApi: StatusKind[] = [
      'unknown',
      'confirmed',
      'started',
      'dos',
      'offline',
      'expired',
      'departed',
    ];
    for (const s of fromApi) {
      const m = statusMeta(s);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.icon).toBeDefined();
      expect(['ok', 'pending', 'warn', 'crit', 'off']).toContain(m.tone);
    }
  });

  it('never draws pending or started as confirmed', () => {
    expect(statusMeta('pending').tone).not.toBe('ok');
    expect(statusMeta('started').tone).not.toBe('ok');
    expect(statusMeta('syncing').tone).not.toBe('ok');
    expect(statusMeta('confirmed').tone).toBe('ok');
  });

  it('keeps critical states critical and absent observations neutral', () => {
    expect(statusMeta('dos').tone).toBe('crit');
    expect(statusMeta('expired').tone).toBe('crit');
    expect(statusMeta('offline').tone).toBe('crit');
    expect(statusMeta('unreachable').tone).toBe('off');
    expect(statusMeta('unknown').tone).toBe('off');
  });

  it('falls back to Unknown for unrecognised, empty and missing values', () => {
    for (const v of ['made-up', '', null, undefined]) {
      expect(statusMeta(v)).toBe(STATUS_META.unknown);
    }
    expect(statusMeta('toString')).toBe(STATUS_META.unknown);
  });

  it('gives every state its own word so a list of chips is never ambiguous', () => {
    const words = Object.values(STATUS_META).map((m) => m.label);
    expect(new Set(words).size).toBe(words.length);
  });

  it('marks only in-progress states as spinning and only the healthy connection as a dot', () => {
    expect(statusMeta('syncing').spin).toBe(true);
    expect(statusMeta('confirmed').spin).toBeUndefined();
    expect(statusMeta('live').dot).toBe(true);
    expect(statusMeta('confirmed').dot).toBeUndefined();
  });
});
