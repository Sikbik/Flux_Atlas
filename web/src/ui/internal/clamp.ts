/** Clamps `n` into `[lo, hi]` (`lo` wins when the range is inverted). */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), Math.max(lo, hi));
}
