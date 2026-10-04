import { describe, expect, it } from 'vitest';
import type { AppDeployDay } from '../../../../api/generated/AppDeployDay';
import { DAY_MS, dayHead, deploySeries, deploySummary, deployTotals, isRunningDay } from './deploy';

const d0 = Date.UTC(2026, 9, 1);
const days: AppDeployDay[] = [
  { day_ms: d0, registered: 10, updated: 30 },
  { day_ms: d0 + DAY_MS, registered: 25, updated: 60 },
  { day_ms: d0 + 2 * DAY_MS, registered: 5, updated: 10 },
  { day_ms: d0 + 3 * DAY_MS, registered: 2, updated: 3 },
];
const midLastDay = d0 + 3 * DAY_MS + 9 * 3_600_000;

describe('deploySeries', () => {
  it('lays the days out as columns and adds registered to updated for the height of a bar', () => {
    const s = deploySeries(days, midLastDay);
    expect(s.registered).toEqual([10, 25, 5, 2]);
    expect(s.updated).toEqual([30, 60, 10, 3]);
    expect(s.total).toEqual([40, 85, 15, 5]);
    expect(s.t[0]).toBe(d0);
  });

  it('knows the last day is still running only while the clock is inside it', () => {
    expect(deploySeries(days, midLastDay).running).toBe(true);
    expect(deploySeries(days, d0 + 4 * DAY_MS + 1).running).toBe(false);
  });

  it('points at the running day, and only that one', () => {
    const s = deploySeries(days, midLastDay);
    expect(isRunningDay(s, 3)).toBe(true);
    expect(isRunningDay(s, 2)).toBe(false);
  });

  it('is empty for no days, with no running day', () => {
    const s = deploySeries([], midLastDay);
    expect(s.t).toEqual([]);
    expect(s.running).toBe(false);
  });
});

describe('deployTotals', () => {
  it('sums the days, running one included, and finds the busiest whole day', () => {
    const t = deployTotals(deploySeries(days, midLastDay));
    expect(t.registered).toBe(42);
    expect(t.updated).toBe(103);
    expect(t.days).toBe(4);
    expect(t.busiest).toEqual({ t: d0 + DAY_MS, total: 85 });
  });

  it('never calls the running day the busiest: it is not a whole day yet', () => {
    const big: AppDeployDay[] = [
      ...days.slice(0, 3),
      { day_ms: d0 + 3 * DAY_MS, registered: 500, updated: 500 },
    ];
    expect(deployTotals(deploySeries(big, midLastDay)).busiest?.total).toBe(85);
    expect(deployTotals(deploySeries(big, d0 + 5 * DAY_MS)).busiest?.total).toBe(1000);
  });

  it('prefers the later of two equal days', () => {
    const tie: AppDeployDay[] = [
      { day_ms: d0, registered: 5, updated: 5 },
      { day_ms: d0 + DAY_MS, registered: 5, updated: 5 },
    ];
    expect(deployTotals(deploySeries(tie, d0 + 3 * DAY_MS)).busiest?.t).toBe(d0 + DAY_MS);
  });

  it('has no busiest day when nothing was deployed, rather than a first day of zero', () => {
    const quiet: AppDeployDay[] = [{ day_ms: d0, registered: 0, updated: 0 }];
    expect(deployTotals(deploySeries(quiet, d0 + 2 * DAY_MS)).busiest).toBeNull();
  });
});

describe('deploySummary', () => {
  it('names the chart: the range, the totals, the busiest day and the day still running', () => {
    const text = deploySummary(deploySeries(days, midLastDay), true);
    expect(text).toContain('over 4 days, 1 Oct 2026 to 4 Oct 2026');
    expect(text).toContain('42 apps were registered and 103 updates were made');
    expect(text).toContain('The busiest whole day was 2 Oct, with 85 messages.');
    expect(text).toContain('still running');
    expect(text).not.toContain('only seen part');
  });

  it('says so when the server has only part of the history', () => {
    expect(deploySummary(deploySeries(days, d0 + 9 * DAY_MS), false)).toContain(
      'only seen part of the history',
    );
  });

  it('uses the singular for one app and one update', () => {
    const one: AppDeployDay[] = [{ day_ms: d0, registered: 1, updated: 1 }];
    expect(deploySummary(deploySeries(one, d0 + 2 * DAY_MS), true)).toContain(
      '1 app was registered and 1 update was made',
    );
  });

  it('says there was nothing for an empty range', () => {
    expect(deploySummary(deploySeries([], 0), true)).toBe(
      'No app registrations or updates were recorded in this range.',
    );
  });
});

describe('dayHead', () => {
  it('is the day in UTC', () => {
    expect(dayHead(deploySeries(days, midLastDay), 1)).toBe('2 Oct 2026');
  });
});
