import { describe, expect, it } from 'vitest';
import type { AppEconomyDto } from '../../../../api/generated/AppEconomyDto';
import { DAY_MS } from './deploy';
import { economyGlance, fluxShort } from './economy';

const d0 = Date.UTC(2026, 6, 1);

/** `n` days from d0, each paying `pay(i)` FLUX. */
function dto(n: number, pay: (i: number) => number, over: Partial<AppEconomyDto> = {}): AppEconomyDto {
  return {
    generated_ms: d0 + n * DAY_MS,
    tip_height: 3_000_000,
    history_complete: true,
    paid_24h: '11000.50000000',
    paid_7d: '75000.00000000',
    paid_30d: '259000.25000000',
    registrations_30d: 1600,
    updates_30d: 4200,
    messages_total: 71_700,
    paid_all_time: '2249071.67159171',
    active_apps: 1950,
    days: Array.from({ length: n }, (_, i) => ({
      day_ms: d0 + i * DAY_MS,
      registrations: 1,
      updates: 1,
      paid: `${pay(i)}.00000000`,
      active_apps: 1900,
    })),
    top_apps_30d: [],
    top_apps_all_time: [],
    ...over,
  };
}

describe('economyGlance', () => {
  const now = d0 + 90 * DAY_MS + 3_600_000;

  it('reads the windows as numbers', () => {
    const g = economyGlance(
      dto(91, () => 100),
      now,
    );
    expect(g.paid24h).toBeCloseTo(11000.5);
    expect(g.paid7d).toBe(75000);
    expect(g.paid30d).toBeCloseTo(259000.25);
    expect(g.paidAllTime).toBeCloseTo(2249071.67, 1);
    expect(g.messages).toBe(71_700);
    expect(g.registrations30d).toBe(1600);
  });

  it('leaves the day still running out of the daily series: it is not a day yet', () => {
    const g = economyGlance(
      dto(91, () => 100),
      now,
    );
    expect(g.daily).toHaveLength(90);
    expect(g.dailyFromMs).toBe(d0);
  });

  it('compares the last 30 whole days with the 30 before', () => {
    const g = economyGlance(
      dto(91, (i) => (i < 60 ? 100 : 150)),
      now,
    );
    expect(g.change).toBeCloseTo(0.5);
  });

  it('has no change without 60 whole days to compare', () => {
    expect(
      economyGlance(
        dto(50, () => 100),
        d0 + 51 * DAY_MS,
      ).change,
    ).toBeNull();
  });

  it('has no change against a month that paid nothing', () => {
    expect(
      economyGlance(
        dto(91, (i) => (i < 60 ? 0 : 150)),
        now,
      ).change,
    ).toBeNull();
  });

  it('keeps every figure unknown, never zero, while the server is still filling its history', () => {
    const g = economyGlance(
      dto(91, () => 100, {
        history_complete: false,
        paid_24h: null,
        paid_7d: null,
        paid_30d: null,
        registrations_30d: null,
        updates_30d: null,
      }),
      now,
    );
    expect(g.complete).toBe(false);
    expect(g.paid24h).toBeNull();
    expect(g.paid30d).toBeNull();
    expect(g.registrations30d).toBeNull();
    expect(g.change).toBeNull();
  });
});

describe('fluxShort', () => {
  it('keeps FLUX to a few characters', () => {
    expect(fluxShort(812.4)).toBe('812');
    expect(fluxShort(74_992.31)).toBe('75.0K');
    expect(fluxShort(259_431.78)).toBe('259K');
    expect(fluxShort(2_249_071.67)).toBe('2.25M');
    expect(fluxShort(0)).toBe('0');
  });
});
