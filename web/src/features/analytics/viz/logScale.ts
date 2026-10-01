// A log10 scale for the Chain charts: equal ratios are equal distances, so values that differ by orders of
// magnitude can share one axis. Same shape as `linear`. Pure.

import { type Linear, linear } from './scale';

/** `domain` must be above zero. A value at or below zero is drawn at the low edge rather than at minus infinity. */
export function logScale(domain: [number, number], range: [number, number]): Linear {
  const [d0, d1] = domain;
  const lin = linear([Math.log10(d0), Math.log10(d1)], range);
  const f = ((v: number) => lin(Math.log10(v > 0 ? v : d0))) as Linear;
  f.invert = (px: number) => 10 ** lin.invert(px);
  f.domain = domain;
  f.range = range;
  return f;
}
