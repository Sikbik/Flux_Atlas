import { describe, expect, it } from 'vitest';
import { NodeSection, statusCode, tierCode } from '../../../api/nodesBin';
import { summarize } from './summary';

const NAN = Number.NaN;

function bin(
  rows: {
    tier: 'cumulus' | 'nimbus' | 'stratus' | 'unknown';
    status: 'confirmed' | 'started' | 'dos';
    lat?: number;
  }[],
  sections: number[],
) {
  return {
    count: rows.length,
    status: Uint8Array.from(rows.map((r) => statusCode(r.status))),
    tier: Uint8Array.from(rows.map((r) => tierCode(r.tier))),
    lat: Float32Array.from(rows.map((r) => r.lat ?? NAN)),
    lon: Float32Array.from(rows.map((r) => (r.lat === undefined ? NAN : 10))),
    present: new Set(sections),
  };
}

const OLD_FORMAT = [
  NodeSection.Ids,
  NodeSection.Lat,
  NodeSection.Lon,
  NodeSection.Tier,
  NodeSection.Status,
  NodeSection.Ips,
  NodeSection.Country,
  NodeSection.Org,
  NodeSection.Version,
  NodeSection.Cores,
  NodeSection.RamGb,
  NodeSection.SsdGb,
];

describe('summarize', () => {
  it('counts confirmed nodes and splits them by tier', () => {
    const b = bin(
      [
        { tier: 'cumulus', status: 'confirmed', lat: 1 },
        { tier: 'cumulus', status: 'confirmed', lat: 2 },
        { tier: 'nimbus', status: 'confirmed' },
        { tier: 'stratus', status: 'confirmed', lat: 3 },
        { tier: 'stratus', status: 'started', lat: 4 },
        { tier: 'cumulus', status: 'dos', lat: 5 },
        { tier: 'unknown', status: 'confirmed', lat: 6 },
      ],
      OLD_FORMAT,
    );
    const s = summarize(b, 1000);
    expect(s.t).toBe(1000);
    expect(s.rows).toBe(7);
    expect(s.nodes).toBe(5);
    expect(s.tiers).toEqual({ cumulus: 2, nimbus: 1, stratus: 1 });
    expect(s.located).toBe(6);
  });

  it('names the facts a recording lacks instead of showing zeros', () => {
    const s = summarize(bin([{ tier: 'cumulus', status: 'confirmed', lat: 1 }], OLD_FORMAT), 0);
    expect(s.missing).toEqual(['Apps per node', 'Payment queue rank', 'Last payment', 'Node flags']);
    expect(s.recorded).toContain('Location');
    expect(s.recorded).toContain('Cores, memory and storage');
    expect(s.recorded).not.toContain('Payment queue rank');
  });

  it('records every fact when every column is there', () => {
    const all = [
      ...OLD_FORMAT,
      NodeSection.AppCount,
      NodeSection.Rank,
      NodeSection.LastPaid,
      NodeSection.Flags,
    ];
    const s = summarize(bin([{ tier: 'nimbus', status: 'confirmed', lat: 1 }], all), 0);
    expect(s.missing).toEqual([]);
    expect(s.recorded.length).toBe(12);
  });

  it('does not count nodes when the status column was not recorded', () => {
    const s = summarize(
      bin([{ tier: 'cumulus', status: 'confirmed', lat: 1 }], [NodeSection.Ids, NodeSection.Tier]),
      0,
    );
    expect(s.nodes).toBeNull();
    expect(s.tiers).toEqual({ cumulus: 0, nimbus: 0, stratus: 0 });
    expect(s.missing).toContain('Status');
  });

  it('handles an empty state', () => {
    const s = summarize(bin([], OLD_FORMAT), 5);
    expect(s.rows).toBe(0);
    expect(s.nodes).toBe(0);
  });
});
