import { describe, expect, it } from 'vitest';
import type { DecentralizationDto } from '../../../../api/generated/DecentralizationDto';
import { decentralModel, gaugeAt, ownershipReading } from './decentral';

const dto = (over: Partial<DecentralizationDto> = {}): DecentralizationDto => ({
  nakamoto_country: 3,
  nakamoto_provider: 8,
  nakamoto_operator: 40,
  hhi_country: 0.1226,
  hhi_provider: 0.0741,
  top_operators: [],
  multi_node_hosts: 900,
  operator_count: 1205,
  operator_sizes: [],
  ...over,
});

describe('decentralModel', () => {
  it('turns the three Nakamoto numbers into figures that agree with their nouns', () => {
    const m = decentralModel(dto({ nakamoto_country: 1 }));
    expect(m?.nakamoto.map((f) => [f.id, f.n, f.noun])).toEqual([
      ['country', 1, 'country'],
      ['provider', 8, 'providers'],
      ['operator', 40, 'operators'],
    ]);
  });

  it('reads the HHI with its band, on the 0 to 1 scale', () => {
    const m = decentralModel(dto({ hhi_country: 0.31, hhi_provider: 0.18 }));
    expect(m?.hhi.map((h) => [h.id, h.text, h.band, h.word])).toEqual([
      ['country', '0.31', 'high', 'high concentration'],
      ['provider', '0.18', 'moderate', 'moderate concentration'],
    ]);
    expect(decentralModel(dto())?.hhi[0]?.band).toBe('low');
  });

  it('says in one reading what the numbers mean together', () => {
    expect(decentralModel(dto())?.reading).toBe(
      'More than half of all nodes run in 3 countries and on 8 providers. It takes 40 operators to reach the same share. Ownership is far more spread out than hosting.',
    );
  });

  it('is null before there is anything to measure', () => {
    expect(
      decentralModel(dto({ nakamoto_country: 0, nakamoto_provider: 0, nakamoto_operator: 0 })),
    ).toBeNull();
  });
});

describe('gaugeAt', () => {
  it('puts each band in its own third of the gauge', () => {
    expect(gaugeAt(0)).toBe(0);
    expect(gaugeAt(0.075)).toBeCloseTo(1 / 6);
    expect(gaugeAt(0.15)).toBeCloseTo(1 / 3);
    expect(gaugeAt(0.2)).toBeCloseTo(1 / 2);
    expect(gaugeAt(0.25)).toBeCloseTo(2 / 3);
    expect(gaugeAt(0.6)).toBe(1);
  });

  it('never leaves the gauge', () => {
    expect(gaugeAt(1)).toBe(1);
    expect(gaugeAt(-1)).toBe(0);
    expect(gaugeAt(Number.NaN)).toBe(0);
  });

  it('only ever moves right as the concentration grows', () => {
    const xs = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.4, 0.6, 1].map(gaugeAt);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });
});

describe('ownershipReading', () => {
  it('compares the operators it takes with the countries or providers it takes', () => {
    expect(ownershipReading(3, 8, 40)).toContain('far more spread out');
    expect(ownershipReading(3, 8, 20)).toContain('more spread out than hosting');
    expect(ownershipReading(3, 8, 12)).toContain('about equally');
    expect(ownershipReading(3, 8, 6)).toContain('A few operators run as much');
  });

  it('says nothing without numbers to compare', () => {
    expect(ownershipReading(0, 0, 0)).toBe('');
    expect(ownershipReading(3, 8, 0)).toBe('');
  });
});
