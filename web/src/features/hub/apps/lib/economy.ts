// What apps pay, as the hub's economy panel reads it: the FLUX paid for app register and update messages over a day,
// a week and a month, the messages behind it, and the daily series for a sparkline. Pure.
//
// What the payload means (`GET /network/app-economy`): `paid_24h`, `paid_7d` and `paid_30d` are null, and the daily
// rows cover only the messages this server has seen, until its one-time backfill of the permanent messages has
// finished (`history_complete`). The last daily row is the day so far.

import type { AppEconomyDto } from '../../../../api/generated/AppEconomyDto';
import { fluxToNumber } from '../../../../lib/format';
import { DAY_MS } from './deploy';

export interface EconomyGlance {
  /** The backfill has finished: the windows are real figures. */
  complete: boolean;
  paid24h: number | null;
  paid7d: number | null;
  paid30d: number | null;
  registrations30d: number | null;
  updates30d: number | null;
  paidAllTime: number | null;
  messages: number;
  /** FLUX paid on each whole UTC day, oldest first (the day still running is left out: it is not a day yet). */
  daily: number[];
  /** The start of the first day in `daily`, for the sparkline's words. */
  dailyFromMs: number | null;
  /** The last 30 whole days against the 30 before, as a fraction (0.12 is 12% more); null without 60 whole days. */
  change: number | null;
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** FLUX in a few characters: `812`, `74.9K`, `261K`, `2.25M`. */
export function fluxShort(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e5) return `${Math.round(v / 1e3)}K`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

export function economyGlance(dto: AppEconomyDto, nowMs: number): EconomyGlance {
  const whole = dto.days.filter((d) => nowMs >= d.day_ms + DAY_MS);
  const daily = whole.map((d) => fluxToNumber(d.paid) ?? 0);
  let change: number | null = null;
  if (dto.history_complete && daily.length >= 60) {
    const recent = sum(daily.slice(-30));
    const before = sum(daily.slice(-60, -30));
    if (before > 0) change = recent / before - 1;
  }
  return {
    complete: dto.history_complete,
    paid24h: fluxToNumber(dto.paid_24h),
    paid7d: fluxToNumber(dto.paid_7d),
    paid30d: fluxToNumber(dto.paid_30d),
    registrations30d: dto.registrations_30d,
    updates30d: dto.updates_30d,
    paidAllTime: fluxToNumber(dto.paid_all_time),
    messages: dto.messages_total,
    daily,
    dailyFromMs: whole[0]?.day_ms ?? null,
    change,
  };
}
