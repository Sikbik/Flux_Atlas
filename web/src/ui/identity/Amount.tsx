import { formatFlux, formatSats, parseFlux } from '../../lib/format';
import { cx } from '../internal/cx';
import { splitTrailingZeros } from './hashParts';
import { Unknown } from './Unknown';
import './identity.css';

export interface AmountProps {
  /** A FLUX amount: the wire decimal string (`"9.00000000"`), a number, or base units as a bigint. */
  value: string | number | bigint | null | undefined;
  /** Fraction digits: 2 in summaries (default). */
  decimals?: number;
  /** Transaction-detail precision: 8 decimals, with the trailing zeros dimmed. */
  exact?: boolean;
  /** Show the unit after the figure: `true` is "FLUX" (default), or pass your own string, or `false`. */
  unit?: boolean | string;
  /** `always` prefixes `+` on positive values (payout chips: `+9.00`). */
  sign?: 'auto' | 'always';
  /** `signed` tints gains and losses (blue and coral, with the sign as the second cue); `hot` is white. */
  tone?: 'default' | 'signed' | 'hot';
  className?: string;
}

/** Formats an amount to text without the unit; null when the value is unknown. Exported for tests and tables. */
export function formatAmountText(
  value: AmountProps['value'],
  opts: { decimals?: number; sign?: 'auto' | 'always' } = {},
): string | null {
  if (value === null || value === undefined) return null;
  const o = { decimals: opts.decimals ?? 2, sign: opts.sign ?? 'auto', unit: false };
  if (typeof value === 'bigint') return formatSats(value, o);
  if (parseFlux(value) === null) return null;
  return formatFlux(value, o, '');
}

/** A FLUX amount in tabular Plex Mono: correct precision, a dim unit, optional sign tint. Unknown renders the word. */
export function Amount({
  value,
  decimals,
  exact,
  unit = true,
  sign,
  tone = 'default',
  className,
}: AmountProps) {
  const text = formatAmountText(value, { decimals: exact ? 8 : decimals, sign });
  if (text === null) return <Unknown />;
  const { main, dim } = exact ? splitTrailingZeros(text) : { main: text, dim: '' };
  const negative = text.startsWith('-');
  const positive = !negative && /[1-9]/.test(text);
  const dir = tone === 'signed' ? (negative ? 'neg' : positive ? 'pos' : undefined) : undefined;
  const unitText = unit === true ? 'FLUX' : unit === false ? '' : unit;
  return (
    <span
      className={cx('ui-amount ui-mono', className)}
      data-tone={tone === 'hot' ? 'hot' : undefined}
      data-dir={dir}
    >
      <span className="ui-amount__figure">
        {main}
        {dim ? <span className="ui-amount__dim">{dim}</span> : null}
      </span>
      {unitText ? <span className="ui-amount__unit">{unitText}</span> : null}
    </span>
  );
}
