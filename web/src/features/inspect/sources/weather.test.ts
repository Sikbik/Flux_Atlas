import { describe, expect, it } from 'vitest';
import type { NodeRow } from '../../../api/generated/NodeRow';
import { STATUS_CODES } from '../../../api/nodesBin';
import { Reach } from '../../../store/nodeTable';
import { buildScan, scanRow } from './weather';

const row = (over: Partial<NodeRow>): NodeRow =>
  ({
    id: 1,
    status: 'confirmed',
    reachable: null,
    last_confirmed_height: null,
    ...over,
  }) as NodeRow;

describe('scanRow', () => {
  it('keeps unknown reachability unknown, never "reachable"', () => {
    expect(scanRow(row({ reachable: null })).reach).toBe(Reach.Unknown);
    expect(scanRow(row({ reachable: true })).reach).toBe(Reach.Yes);
    expect(scanRow(row({ reachable: false })).reach).toBe(Reach.No);
  });

  it('turns a status word into its wire code and a missing check-in into 0', () => {
    const r = scanRow(row({ status: 'dos', last_confirmed_height: null }));
    expect(STATUS_CODES[r.status]).toBe('dos');
    expect(r.lastConfirmed).toBe(0);
    expect(scanRow(row({ last_confirmed_height: 2_997_000 })).lastConfirmed).toBe(2_997_000);
  });
});

describe('buildScan', () => {
  it('lays the rows into columns and indexes them by node id', () => {
    const scan = buildScan([
      scanRow(row({ id: 7, reachable: false })),
      scanRow(row({ id: 3, reachable: true, last_confirmed_height: 900 })),
    ]);
    expect([...scan.ids]).toEqual([7, 3]);
    expect(scan.index.get(3)).toBe(1);
    expect(scan.reach[0]).toBe(Reach.No);
    expect(scan.lastConfirmed[1]).toBe(900);
  });

  it('is empty for no rows', () => {
    const scan = buildScan([]);
    expect(scan.ids.length).toBe(0);
    expect(scan.index.size).toBe(0);
  });
});
