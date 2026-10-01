// Pure helpers for the Slider: where a value sits on the track, how many decimals a step implies, how
// the readout is formatted, and how tick marks are normalised. No DOM, so they are unit tested.

import { formatInt } from '../../lib/format';
import { clamp } from '../internal/clamp';

export interface SliderMark {
  /** Position on the scale. */
  value: number;
  /** Text under the tick (mono). Omit for a bare tick. */
  label?: string;
}

/** The fraction (0 to 1) of the way from `min` to `max` that `value` sits; 0 for an empty range. */
export function fractionOf(value: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

/** Fraction digits a step implies: `1` -> 0, `0.5` -> 1, `0.025` -> 3 (at most 6). */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0 || Number.isInteger(step)) return 0;
  const text = step.toString();
  if (text.includes('e-')) return Math.min(6, Number(text.split('e-')[1]));
  return Math.min(6, text.split('.')[1]?.length ?? 0);
}

/** The default readout: grouped integers for whole steps (`2,996,914`), fixed decimals otherwise (`98.5`). */
export function formatSliderValue(value: number, step: number): string {
  const decimals = decimalsOf(step);
  return decimals === 0 ? formatInt(value) : value.toFixed(decimals);
}

/** Marks as objects, inside the range, sorted and without duplicates. */
export function normalizeMarks(
  marks: ReadonlyArray<number | SliderMark> | undefined,
  min: number,
  max: number,
): SliderMark[] {
  if (!marks) return [];
  const seen = new Set<number>();
  const out: SliderMark[] = [];
  for (const m of marks) {
    const mark = typeof m === 'number' ? { value: m } : m;
    if (!Number.isFinite(mark.value) || mark.value < min || mark.value > max || seen.has(mark.value))
      continue;
    seen.add(mark.value);
    out.push(mark);
  }
  return out.sort((a, b) => a.value - b.value);
}
