import { describe, expect, it } from 'vitest';
import type { ExpiringApp } from '../../../../api/generated/ExpiringApp';
import type { NewestApp } from '../../../../api/generated/NewestApp';
import { expiringRows, newRows, runningText } from './rows';

const H = 3_600_000;
const D = 24 * H;
const now = Date.UTC(2026, 9, 4, 12, 0);

describe('runningText', () => {
  it('counts the instances up, and says none for none', () => {
    expect(runningText(1200)).toBe('1,200 running');
    expect(runningText(0)).toBe('none running');
  });
});

describe('newRows', () => {
  const list: NewestApp[] = [
    { name: 'alpha', display_name: 'Alpha', height: 3_007_900, time_ms: now - 3 * H, instances: 4 },
    { name: 'beta', display_name: '', height: 3_007_800, time_ms: null, instances: 0 },
  ];

  it('words the registration time as an estimate, with the block in the tooltip', () => {
    const [a] = newRows(list, now);
    expect(a?.label).toBe('Alpha');
    expect(a?.when).toBe('Registered about 3 hours ago');
    expect(a?.whenTitle).toBe(`Estimated 2026-10-04 09:00 UTC, block 3,007,900`);
    expect(a?.running).toBe('4 running');
  });

  it('falls back to the block, which is exact, when the time is not known, and invents no time', () => {
    const b = newRows(list, now)[1];
    expect(b?.label).toBe('beta');
    expect(b?.when).toBe('Registered at block 3,007,800');
    expect(b?.whenTitle).toBeUndefined();
    expect(b?.running).toBe('none running');
  });
});

describe('expiringRows', () => {
  const list: ExpiringApp[] = [
    {
      name: 'gone-soon',
      display_name: 'Gone Soon',
      expire_height: 3_008_000,
      blocks_left: 80,
      expire_ms: now + 40 * 60_000,
      instances: 7,
    },
    {
      name: 'later',
      display_name: 'Later',
      expire_height: 3_137_600,
      blocks_left: 129_600,
      expire_ms: now + 45 * D,
      instances: 0,
    },
  ];

  it('gives the estimate in words and the block count as the exact figure', () => {
    const [a] = expiringRows(list, now);
    expect(a?.when).toBe('Expires in about 40 minutes');
    expect(a?.blocks).toBe('80 blocks left');
    expect(a?.whenTitle).toBe('Estimated 2026-10-04 12:40 UTC, block 3,008,000');
  });

  it('marks the ones within the hour', () => {
    const rows = expiringRows(list, now);
    expect(rows[0]?.soon).toBe(true);
    expect(rows[1]?.soon).toBe(false);
    expect(rows[1]?.when).toBe('Expires in about a month');
  });
});
