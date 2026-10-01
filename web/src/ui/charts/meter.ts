// Meter logic with no DOM: where a reading falls in its range, the coloured zones of a gauge, and
// the sentence that stands in for the picture.

import { formatPercent, UNKNOWN } from '../../lib/format';
import { clamp01 } from './scale';

/** The fill and zone colours: the accent, or one of the reserved status roles. */
export type MeterTone = 'accent' | 'ok' | 'warn' | 'crit';

export const TONE_COLOR: Readonly<Record<MeterTone, string>> = {
  accent: 'var(--accent-500)',
  ok: 'var(--status-ok)',
  warn: 'var(--status-warn)',
  crit: 'var(--status-crit)',
};

export interface MeterZoneLike {
  from: number;
  to: number;
  tone: MeterTone;
  label?: string;
}

/** A zone as fractions of the range (`from` and `to` in 0..1, `from < to`). */
export interface ZoneBand {
  from: number;
  to: number;
  tone: MeterTone;
  label?: string;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A usable range: an inverted or empty one falls back to 0..1. */
export function normalizeRange(
  min: number | undefined,
  max: number | undefined,
): { min: number; max: number } {
  const lo = isNum(min) ? min : 0;
  const hi = isNum(max) ? max : 1;
  return hi > lo ? { min: lo, max: hi } : { min: 0, max: 1 };
}

/** Where `value` falls in `min..max` as 0..1 (clamped), or `null` for a missing or non-finite reading. */
export function fractionOf(value: number | null | undefined, min: number, max: number): number | null {
  if (!isNum(value)) return null;
  const span = max - min;
  if (!(span > 0)) return null;
  return clamp01((value - min) / span);
}

/** The reading kept inside the range (what `aria-valuenow` reports), or `null`. */
export function clampToRange(value: number | null | undefined, min: number, max: number): number | null {
  if (!isNum(value)) return null;
  return Math.min(max, Math.max(min, value));
}

/** Zones as sorted, clipped fractions of the range; empty, inverted and non-finite zones are dropped. */
export function zoneBands(zones: readonly MeterZoneLike[] | undefined, min: number, max: number): ZoneBand[] {
  if (!zones) return [];
  const bands: ZoneBand[] = [];
  for (const z of zones) {
    if (!isNum(z.from) || !isNum(z.to)) continue;
    const from = fractionOf(z.from, min, max);
    const to = fractionOf(z.to, min, max);
    if (from === null || to === null || to <= from) continue;
    bands.push({ from, to, tone: z.tone, label: z.label });
  }
  return bands.sort((a, b) => a.from - b.from);
}

/** The zone a fraction falls in (a zone owns its start, and the last zone also owns the very end of the range). */
export function zoneAt(bands: readonly ZoneBand[], fraction: number | null): ZoneBand | undefined {
  if (fraction === null) return undefined;
  return bands.find(
    (b, i) => fraction >= b.from && (fraction < b.to || (i === bands.length - 1 && fraction <= b.to)),
  );
}

/** The default reading text: the share of the range, `61.9%`. */
export function defaultFormat(_value: number, fraction: number): string {
  return formatPercent(fraction);
}

/** The reading as text, and the zone it falls in: `92.9%: Healthy`. "Unknown" for a missing reading. */
export function readingText(
  value: number | null | undefined,
  min: number,
  max: number,
  format: (value: number, fraction: number) => string = defaultFormat,
  bands: readonly ZoneBand[] = [],
): string {
  const fraction = fractionOf(value, min, max);
  const v = clampToRange(value, min, max);
  if (fraction === null || v === null) return UNKNOWN;
  const zone = zoneAt(bands, fraction);
  const text = format(v, fraction);
  return zone?.label ? `${text}: ${zone.label}` : text;
}
