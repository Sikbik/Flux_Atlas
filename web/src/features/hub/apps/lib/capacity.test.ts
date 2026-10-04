import { describe, expect, it } from 'vitest';
import type { AppsResources } from '../../../../api/generated/AppsResources';
import { railRows, railsNote, railsSummary } from './capacity';

const res: AppsResources = {
  used: { cores: 6934, ram_gb: 12_129, ssd_gb: 125_304 },
  network: { cores: 56_223, ram_gb: 188_267, ssd_gb: 3_282_734 },
};

describe('railRows', () => {
  const rows = railRows(res);

  it('reads cores, memory and storage in the units of the capacity view', () => {
    expect(rows.map((r) => r.label)).toEqual(['CPU', 'Memory', 'Storage']);
    expect(rows[0]?.usedText).toBe('6,934 cores');
    expect(rows[0]?.totalText).toBe('56,223 cores');
    expect(rows[1]?.usedText).toBe('12.1 TB');
    expect(rows[1]?.totalText).toBe('188.3 TB');
    expect(rows[2]?.usedText).toBe('125.3 TB');
    expect(rows[2]?.totalText).toBe('3.28 PB');
  });

  it('gives each resource its share of the network', () => {
    expect(rows[0]?.share).toBeCloseTo(0.1233, 3);
    expect(rows[0]?.percent).toBe('12.3%');
    expect(rows[2]?.percent).toBe('3.8%');
  });

  it('keeps a small share from reading as zero', () => {
    const tiny = railRows({
      used: { cores: 1, ram_gb: 1, ssd_gb: 1 },
      network: { cores: 100_000, ram_gb: 100_000, ssd_gb: 100_000 },
    });
    expect(tiny[0]?.percent).toBe('<0.1%');
  });

  it('is unknown, not 0%, when the network capacity is not known', () => {
    const none = railRows({ used: res.used, network: { cores: 0, ram_gb: 0, ssd_gb: 0 } });
    expect(none.every((r) => r.share === null)).toBe(true);
    expect(none[0]?.percent).toBe('Unknown');
    expect(none[0]?.ofText).toBe('network total not known');
    expect(rows[0]?.ofText).toBe('of 56,223 cores');
  });

  it('never draws a share past the whole', () => {
    const over = railRows({
      used: { cores: 120, ram_gb: 1, ssd_gb: 1 },
      network: { cores: 100, ram_gb: 10, ssd_gb: 10 },
    });
    expect(over[0]?.share).toBe(1);
  });
});

describe('railsSummary', () => {
  it('says what apps with a public spec lock of each', () => {
    expect(railsSummary(railRows(res))).toBe(
      "Apps with a public spec lock 12.3% of the network's cores, 6.4% of its memory and 3.8% of its storage.",
    );
  });

  it('says so when the capacity is not known', () => {
    const none = railRows({ used: res.used, network: { cores: 0, ram_gb: 0, ssd_gb: 0 } });
    expect(railsSummary(none)).toBe('The network capacity is not known yet.');
  });
});

describe('railsNote', () => {
  it('says the sizes count public specs, and that apps hold at least this much when enterprise apps keep theirs private', () => {
    expect(railsNote(996)).toBe(
      'These count apps with a public spec. 996 enterprise apps keep their size private, so apps hold at least this much.',
    );
    expect(railsNote(1)).toContain('1 enterprise app keeps its size private');
  });

  it('says only the first part when there are no enterprise apps, or when that is not known', () => {
    expect(railsNote(0)).toBe('These count apps with a public spec.');
    expect(railsNote(null)).toBe('These count apps with a public spec.');
  });
});
