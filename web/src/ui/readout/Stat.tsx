import type { ReactNode } from 'react';
import { isUnknownValue, Unknown } from '../identity/Unknown';
import { cx } from '../internal/cx';
import { Skeleton } from '../states/Skeleton';
import './Stat.css';

export interface StatProps {
  /** What is measured, in sentence case without a colon ("Nodes", "FLUX price"). */
  label: ReactNode;
  /** The figure, already formatted (a string, or an AnimatedNumber for a live count). Null or undefined renders Unknown, never 0. */
  value?: ReactNode;
  /** A small unit after the figure ("FLUX", "nodes", "TB"). */
  unit?: ReactNode;
  /** The change over a named period: pass a Delta. */
  delta?: ReactNode;
  /** One line of context under the figure ("2,655 IP addresses"). */
  caption?: ReactNode;
  /** A sparkline (64 x 26 px) shown in the top right corner. */
  spark?: ReactNode;
  /** The view's one hero figure: larger numerals and a chamfered corner (use once per view). */
  hero?: boolean;
  /** Show skeleton bars with the geometry of the loaded tile. */
  loading?: boolean;
  /** Upstream data is stale: shows "No data" and this warning line instead of a figure (never a blank or a zero). */
  stale?: ReactNode;
  /** Makes the whole tile a button. */
  onClick?: () => void;
  /** Tier tint for the corner light (node views). */
  tier?: 'cumulus' | 'nimbus' | 'stratus';
  className?: string;
}

/** A stat tile: label, a big tabular figure with an optional unit, a delta, a caption and a sparkline slot. */
export function Stat({
  label,
  value,
  unit,
  delta,
  caption,
  spark,
  hero,
  loading,
  stale,
  onClick,
  tier,
  className,
}: StatProps) {
  const Tag = onClick ? 'button' : 'div';
  const unknown = !loading && !stale && isUnknownValue(value);
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={cx('ui-stat', className)}
      data-hero={hero || undefined}
      data-spark={spark ? '' : undefined}
      data-state={loading ? 'loading' : stale ? 'stale' : undefined}
      data-tier={tier}
      aria-busy={loading || undefined}
      onClick={onClick}
    >
      <span className="ui-stat__label">{label}</span>
      {loading ? (
        <>
          <Skeleton className="ui-stat__skel-value" w="70%" h={hero ? 36 : 24} />
          <Skeleton w="45%" h={12} />
        </>
      ) : (
        <>
          <span className="ui-stat__value">
            {stale ? (
              <span className="ui-stat__nodata">No data</span>
            ) : unknown ? (
              <Unknown className="ui-stat__unknown" />
            ) : (
              <>
                {value}
                {unit ? <span className="ui-stat__unit">{unit}</span> : null}
              </>
            )}
          </span>
          {stale ? <span className="ui-stat__stale">{stale}</span> : null}
          {delta && !stale ? <span className="ui-stat__delta">{delta}</span> : null}
          {caption && !stale ? <span className="ui-stat__caption">{caption}</span> : null}
        </>
      )}
      {spark && !loading ? <span className="ui-stat__spark">{spark}</span> : null}
    </Tag>
  );
}
