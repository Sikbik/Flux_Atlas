// Signed change formatting for deltas: the sign is carried by an arrow, a plus or minus, and
// colour, never colour alone (design 5.6).

export type DeltaDirection = 'up' | 'down' | 'flat';

export interface FormattedDelta {
  text: string;
  direction: DeltaDirection;
}

const fmtCache = new Map<number, Intl.NumberFormat>();

function numberFormat(decimals: number): Intl.NumberFormat {
  let f = fmtCache.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    fmtCache.set(decimals, f);
  }
  return f;
}

/**
 * Formats a change as `+23`, `-1,204`, `+1.95%` or `0`. A change that rounds to zero at the shown
 * precision is flat (no sign, no arrow direction), so `+0.00%` never appears.
 */
export function formatDelta(
  value: number,
  opts: { kind?: 'count' | 'percent'; decimals?: number } = {},
): FormattedDelta {
  const kind = opts.kind ?? 'count';
  const decimals = opts.decimals ?? (kind === 'percent' ? 2 : 0);
  const body = numberFormat(decimals).format(Math.abs(value));
  const zero = !/[1-9]/.test(body);
  const suffix = kind === 'percent' ? '%' : '';
  if (zero) return { text: `${body}${suffix}`, direction: 'flat' };
  return value > 0
    ? { text: `+${body}${suffix}`, direction: 'up' }
    : { text: `-${body}${suffix}`, direction: 'down' };
}
