import { describe, expect, it } from 'vitest';
import type { RichMove } from '../../../../api/generated/RichMove';
import type { RichMoversDto } from '../../../../api/generated/RichMoversDto';
import { DEV_FUND_ADDRESS } from '../../lib/entities';
import { DAY_MS } from './daily';
import {
  concentrationTrend,
  moversView,
  pickMovers,
  rankShift,
  shiftText,
  signedFlux,
  trackingNote,
  trendText,
} from './movers';

const move = (
  address: string,
  balance: string,
  prev: string,
  rank: number | null,
  prevRank: number | null,
): RichMove => ({
  address,
  rank,
  prev_rank: prevRank,
  balance,
  prev_balance: prev,
  delta: (Number(balance) - Number(prev)).toFixed(8),
  node_count: 0,
});

const T = Date.UTC(2026, 9, 4);

function dto(over: Partial<RichMoversDto> = {}): RichMoversDto {
  return {
    window: '7d',
    to_ms: T,
    from_ms: T - 7 * DAY_MS,
    snapshots: 8,
    gainers: [],
    losers: [],
    entered: [],
    left: [],
    concentration: [],
    ...over,
  };
}

describe('rankShift', () => {
  it('reads a lower rank number as a higher place', () => {
    expect(rankShift(9, 14)).toEqual({ kind: 'up', places: 5 });
    expect(rankShift(14, 9)).toEqual({ kind: 'down', places: 5 });
    expect(rankShift(3, 3)).toEqual({ kind: 'same' });
  });

  it('knows an address that entered or left the list, and says nothing when it knows neither', () => {
    expect(rankShift(38, null)).toEqual({ kind: 'new' });
    expect(rankShift(null, 12)).toEqual({ kind: 'gone' });
    expect(rankShift(null, null)).toBeNull();
  });

  it('puts it in words, one place singular', () => {
    expect(shiftText({ kind: 'up', places: 5 })).toBe('up 5 places');
    expect(shiftText({ kind: 'down', places: 1 })).toBe('down 1 place');
    expect(shiftText({ kind: 'new' })).toBe('entered the list');
    expect(shiftText({ kind: 'gone' })).toBe('left the list');
    expect(shiftText({ kind: 'same' })).toBe('same rank');
    expect(shiftText(null)).toBe('');
  });
});

describe('pickMovers', () => {
  it('sorts the gains and the losses by size whatever order they arrive in, and keeps the top n', () => {
    const r = pickMovers(
      {
        gainers: [
          move('a', '110', '100', 5, 6),
          move('b', '300', '100', 2, 8),
          move('c', '150', '100', 4, 5),
          move('d', '120', '100', 4, 5),
        ],
        losers: [move('x', '90', '100', 7, 6), move('y', '10', '100', 40, 9)],
      },
      3,
    );
    expect(r.gainers.map((g) => g.address)).toEqual(['b', 'c', 'd']);
    expect(r.losers.map((l) => l.address)).toEqual(['y', 'x']);
  });

  it('keeps a gain out of the losses and a loss out of the gains', () => {
    const r = pickMovers(
      { gainers: [move('a', '90', '100', 1, 1)], losers: [move('b', '110', '100', 1, 1)] },
      3,
    );
    expect(r.gainers).toEqual([]);
    expect(r.losers).toEqual([]);
  });

  it('reads the change as a percent of the balance before, and as nothing when there was none', () => {
    const r = pickMovers(
      { gainers: [move('a', '150', '100', 1, 2), move('b', '50', '0', 9, null)], losers: [] },
      3,
    );
    expect(r.gainers[0]?.deltaPct).toBeCloseTo(50);
    expect(r.gainers[1]?.deltaPct).toBeNull();
    expect(r.gainers[1]?.shift).toEqual({ kind: 'new' });
  });

  it('labels a known address and skips a row it cannot read', () => {
    const r = pickMovers(
      {
        gainers: [
          move(DEV_FUND_ADDRESS, '12', '10', 1, 1),
          { ...move('z', 'nope', '1', 1, 1), balance: 'nope' },
        ],
        losers: [],
      },
      3,
    );
    expect(r.gainers).toHaveLength(1);
    expect(r.gainers[0]?.entity?.label).toBe('Dev fund');
  });
});

describe('moversView', () => {
  it('is a tracking state while the server holds fewer than two snapshots, whatever else it sent', () => {
    expect(moversView(dto({ snapshots: 0, from_ms: null }))).toEqual({
      state: 'tracking',
      snapshots: 0,
      trend: null,
    });
    expect(moversView(dto({ snapshots: 1, from_ms: null })).state).toBe('tracking');
    // Two snapshots but no start of the comparison is still nothing to compare.
    expect(moversView(dto({ snapshots: 2, from_ms: null })).state).toBe('tracking');
  });

  it('shapes a comparison: the top rows, the entries and exits, the days it spans', () => {
    const v = moversView(
      dto({
        gainers: [move('a', '200', '100', 3, 4)],
        losers: [move('b', '50', '100', 20, 12)],
        entered: [
          { address: 'e2', rank: 90, balance: '9', node_count: 0 },
          { address: 'e1', rank: 40, balance: '10', node_count: 1 },
        ],
        left: [{ address: 'l', prev_rank: 800, prev_balance: '7' }],
      }),
    );
    expect(v.state).toBe('ready');
    if (v.state !== 'ready') return;
    expect(v.spanDays).toBe(7);
    expect(v.partial).toBe(false);
    expect(v.quiet).toBe(false);
    expect(v.gainers).toHaveLength(1);
    expect(v.entered.map((e) => e.address)).toEqual(['e1', 'e2']);
    expect(v.left[0]?.prevRank).toBe(800);
  });

  it('says so when the history is shorter than the window', () => {
    const v = moversView(dto({ window: '30d', from_ms: T - 3 * DAY_MS, snapshots: 4 }));
    expect(v.state === 'ready' && v.partial).toBe(true);
    expect(v.state === 'ready' && v.spanDays).toBe(3);
  });

  it('calls a comparison with no movement quiet, which is not the tracking state', () => {
    const v = moversView(dto());
    expect(v.state).toBe('ready');
    expect(v.state === 'ready' && v.quiet).toBe(true);
  });

  it('carries the concentration trend', () => {
    const v = moversView(
      dto({
        concentration: [
          { day_ms: T - DAY_MS, top10_pct: 57.4, top100_pct: 80, top1000_pct: 93 },
          { day_ms: T, top10_pct: 57.7, top100_pct: 80.1, top1000_pct: 93 },
        ],
      }),
    );
    expect(v.state === 'ready' && v.trend?.change).toBeCloseTo(0.3);
  });
});

describe('concentrationTrend', () => {
  const pt = (day: number, t10: number) => ({
    day_ms: T + day * DAY_MS,
    top10_pct: t10,
    top100_pct: 80,
    top1000_pct: 93,
  });

  it('orders the days, and reads the change from the first to the last', () => {
    const t = concentrationTrend([pt(2, 58), pt(0, 57), pt(1, 57.5)]);
    expect(t?.values).toEqual([57, 57.5, 58]);
    expect(t?.change).toBeCloseTo(1);
  });

  it('needs two days, and drops a day that is not a number', () => {
    expect(concentrationTrend([pt(0, 57)])).toBeNull();
    expect(concentrationTrend([])).toBeNull();
    expect(concentrationTrend(undefined)).toBeNull();
    expect(concentrationTrend([pt(0, 57), pt(1, Number.NaN)])).toBeNull();
  });

  it('can read the top hundred instead', () => {
    const t = concentrationTrend([pt(0, 57), pt(1, 58)], 'top100_pct');
    expect(t?.values).toEqual([80, 80]);
  });

  it('puts the change in words', () => {
    expect(trendText(0.3)).toBe('up 0.3 points');
    expect(trendText(-1.24)).toBe('down 1.2 points');
    expect(trendText(0.01)).toBe('unchanged');
    expect(trendText(1)).toBe('up 1.0 point');
  });
});

describe('the words around the tracking state', () => {
  it('tells a server with nothing saved from one with a single picture', () => {
    expect(trackingNote(0).title).toMatch(/not started/);
    expect(trackingNote(1).title).toMatch(/One snapshot/);
    expect(trackingNote(1).body).toMatch(/two daily pictures/);
  });

  it('writes a signed compact amount', () => {
    expect(signedFlux(1_250_000)).toBe('+1.3M');
    expect(signedFlux(-340_000)).toBe('-340K');
    expect(signedFlux(850)).toBe('+850');
    expect(signedFlux(0)).toBe('0');
    expect(signedFlux(Number.NaN)).toBe('0');
  });
});
