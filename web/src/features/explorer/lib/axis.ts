// Axis labels for a series that hardly moves. The kit's time series goes compact from 10,000 up with one
// decimal (`678.2K`), which is right while the series travels far and prints the same label several
// times when it does not (a balance that stays between 678,100 and 678,230 would read 678.1K, 678.2K,
// 678.2K, 678.1K). This returns a formatter for that case, or `undefined` to leave the kit's own choice
// alone.
//
// The chart's value gutter is a fixed 50 px, room for six characters of Plex Mono: a longer label is cut
// at the left edge. So the digits come plain (`678150`) when they fit, and when they cannot (a balance of
// 100,000,000 that moves by 50) the axis goes bare, no labels at all, rather than repeat itself or clip.
// The hover readout and the data table still carry exact values.

/** What the chart's value gutter holds. */
const MAX_CHARS = 6;

/** The smallest step between two compact labels once the top of the axis is this large. */
const compactUnit = (top: number): number => (top >= 1e9 ? 1e8 : top >= 1e6 ? 1e5 : top >= 1e4 ? 1e2 : 0);

export function axisFormat(values: readonly number[]): ((value: number) => string) | undefined {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi < lo) return undefined;
  const unit = compactUnit(Math.max(Math.abs(lo), Math.abs(hi)));
  const span = hi - lo;
  // Ticks sit about a quarter of the span apart at the closest; leave room for the kit to pick more of them.
  if (unit === 0 || span >= unit * 8) return undefined;
  const step = span / 8;
  const decimals = step > 0 && step < 1 ? Math.min(4, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9))) : 0;
  const plain = new Intl.NumberFormat('en-US', {
    useGrouping: false,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (Math.max(plain.format(lo).length, plain.format(hi).length) <= MAX_CHARS) {
    return (value) => plain.format(value);
  }
  return () => '';
}
