import { describe, expect, it } from 'vitest';
import type { NewestNode } from '../../../../api/generated/NewestNode';
import { NEWEST_SHOWN, newestRows } from './newest';

const node = (i: number, over: Partial<NewestNode> = {}): NewestNode => ({
  node_key: `${i.toString(16).padStart(64, '0')}:0`,
  tier: 'nimbus',
  country_code: 'FR',
  country: 'France',
  provider: 'OVH',
  provider_key: 'ovh',
  active_since_ms: 1_000_000 - i,
  ...over,
});

describe('newestRows', () => {
  it('keeps the server order (newest first) and shows ten', () => {
    const rows = newestRows(Array.from({ length: 14 }, (_, i) => node(i)));
    expect(rows).toHaveLength(NEWEST_SHOWN);
    expect(rows[0]?.sinceMs).toBeGreaterThan(rows[9]?.sinceMs ?? 0);
  });

  it('carries the outpoint as the key and a short form for a name', () => {
    const [r] = newestRows([node(255)]);
    expect(r?.key).toBe(`${'0'.repeat(62)}ff:0`);
    expect(r?.shortKey).toMatch(/^0{6}….*:0$/);
  });

  it('names the tier, and does not guess one the server did not give', () => {
    const rows = newestRows([node(1), node(2, { tier: 'unknown' })]);
    expect(rows[0]?.tierName).toBe('Nimbus');
    expect(rows[1]?.tier).toBe('unknown');
    expect(rows[1]?.tierName).toBe('Unknown tier');
  });

  it('shows the country name, else its code, else nothing', () => {
    const rows = newestRows([
      node(1),
      node(2, { country: null }),
      node(3, { country: null, country_code: null, provider: null, provider_key: null }),
    ]);
    expect(rows.map((r) => r.country)).toEqual(['France', 'FR', null]);
    expect(rows[2]?.provider).toBeNull();
  });

  it('is empty without an answer', () => {
    expect(newestRows(undefined)).toEqual([]);
  });
});
