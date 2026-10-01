import { describe, expect, it } from 'vitest';
import type { MetricsSeriesDto } from '../../../api/generated/MetricsSeriesDto';
import {
  bridgeGaps,
  differences,
  frameFromDto,
  knownCount,
  rangeWindow,
  sumSeries,
  trimEmpty,
  withLiveTail,
} from './metrics';

const HOUR = 3_600_000;

/** Two backfilled hours (tier counts only, the rest not recorded), two recorded hours, one open bucket. */
const dto: MetricsSeriesDto = {
  from_ms: 0,
  to_ms: 5 * HOUR,
  step_ms: HOUR,
  t: [0, HOUR, 2 * HOUR, 3 * HOUR, 4 * HOUR],
  series: {
    tip_height: [null, null, 2_997_000, 2_997_120, null],
    node_count: [6500, 6510, 6520, 6530, null],
    stratus: [1700, 1701, 1702, 1703, null],
    host_count: [null, null, 2650, 2655, null],
    pending_app_count: [null, null, 0, 2, null],
    dos_count: [null, null, 0, 0, null],
    price_usd: [null, null, 0.0737, 0.0738, null],
  },
};

describe('frameFromDto', () => {
  const f = frameFromDto(dto);

  it('keeps the node counts of backfilled rows', () => {
    expect(f.v.node_count).toEqual([6500, 6510, 6520, 6530, null]);
    expect(f.v.stratus).toEqual([1700, 1701, 1702, 1703, null]);
  });

  it('keeps what the server did not record as unknown', () => {
    expect(f.v.host_count).toEqual([null, null, 2650, 2655, null]);
    expect(f.v.price_usd).toEqual([null, null, 0.0737, 0.0738, null]);
    expect(f.v.tip_height).toEqual([null, null, 2_997_000, 2_997_120, null]);
  });

  it('keeps a real 0 as 0', () => {
    expect(f.v.pending_app_count).toEqual([null, null, 0, 2, null]);
    expect(f.v.dos_count).toEqual([null, null, 0, 0, null]);
  });

  it('turns a value that is not a finite number into unknown', () => {
    const g = frameFromDto({ ...dto, series: { a: [1, Number.NaN, Number.POSITIVE_INFINITY, 4, null] } });
    expect(g.v.a).toEqual([1, null, null, 4, null]);
  });
});

describe('trimEmpty and withLiveTail', () => {
  const f = frameFromDto(dto);

  it('drops the open bucket at the end', () => {
    const t = trimEmpty(f, ['node_count']);
    expect(t.t).toEqual([0, HOUR, 2 * HOUR, 3 * HOUR]);
    expect(t.v.node_count).toHaveLength(4);
  });

  it('returns the same frame when nothing needs trimming', () => {
    const t = trimEmpty(f, ['node_count']);
    expect(trimEmpty(t, ['node_count'])).toBe(t);
  });

  it('appends a live point only when it is newer than the last bucket', () => {
    const t = trimEmpty(f, ['node_count']);
    const live = withLiveTail(t, 3 * HOUR + 20 * 60_000, { node_count: 6540, stratus: 1704 });
    expect(live.t.at(-1)).toBe(3 * HOUR + 20 * 60_000);
    expect(live.v.node_count!.at(-1)).toBe(6540);
    expect(live.v.host_count!.at(-1)).toBeNull();
    expect(withLiveTail(t, 3 * HOUR, { node_count: 1 })).toBe(t);
  });
});

describe('bridgeGaps', () => {
  const frame = (vals: (number | null)[]) => ({
    t: vals.map((_, i) => i * HOUR),
    v: { node_count: vals },
  });

  it('removes one or two missing buckets between known ones', () => {
    const g = bridgeGaps(frame([10, null, 12, null, null, 15]), ['node_count']);
    expect(g.t).toEqual([0, 2 * HOUR, 5 * HOUR]);
    expect(g.v.node_count).toEqual([10, 12, 15]);
  });

  it('keeps a longer outage as a gap', () => {
    const f = frame([10, null, null, null, 14]);
    expect(bridgeGaps(f, ['node_count'])).toBe(f);
  });

  it('never touches the edges (the open bucket and a late start are not gaps)', () => {
    const f = frame([null, 10, 11, null]);
    expect(bridgeGaps(f, ['node_count'])).toBe(f);
  });

  it('treats a bucket as known when any listed series has a value', () => {
    const f = { t: [0, HOUR, 2 * HOUR], v: { a: [1, null, 3], b: [1, 2, 3] } };
    expect(bridgeGaps(f, ['a', 'b'])).toBe(f);
  });
});

describe('derived series', () => {
  it('differences consecutive points and keeps unknown ends unknown', () => {
    expect(differences([1, 4, null, 9, 10])).toEqual([null, 3, null, null, 1]);
  });

  it('sums series per bucket and goes unknown when any part is unknown', () => {
    const f = frameFromDto({
      ...dto,
      series: { cumulus: [1, 2, null], nimbus: [10, 20, 30], stratus: [100, 200, 300] },
      t: [0, 1, 2],
    });
    expect(sumSeries(f, ['cumulus', 'nimbus', 'stratus'])).toEqual([111, 222, null]);
  });

  it('counts known points', () => {
    expect(knownCount([1, null, 3, null])).toBe(2);
  });
});

describe('rangeWindow', () => {
  it('ends at the next step boundary so the request key is stable within a step', () => {
    const now = 1_790_818_200_000;
    const a = rangeWindow('30d', now);
    const b = rangeWindow('30d', now + 600_000);
    expect(a.step).toBe(HOUR);
    expect(a.to % HOUR).toBe(0);
    expect(a.to - a.from).toBe(30 * 24 * HOUR);
    expect(a.to).toBeGreaterThan(now);
    expect(a.to).toBeLessThanOrEqual(now + HOUR);
    // 10 minutes later may or may not cross a boundary, but within a step the key is identical.
    expect(b.to - a.to === 0 || b.to - a.to === HOUR).toBe(true);
    expect(rangeWindow('24h', now).step).toBe(15 * 60_000);
  });
});
