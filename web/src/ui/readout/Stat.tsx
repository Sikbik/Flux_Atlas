import type { PointerEvent, ReactNode } from 'react';
import { isUnknownValue, Unknown } from '../identity/Unknown';
import { cx } from '../internal/cx';
import { useSpotlight } from '../internal/spotlight';
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
  /** A sparkline in the top right corner (a Sparkline; the hero tile takes a larger one at the lower right). */
  spark?: ReactNode;
  /** The view's one hero figure: large light numerals, a lit rim and the hexagon chamfer (use once per view). */
  hero?: boolean;
  /** Show skeleton bars with the geometry of the loaded tile (no layout shift when the figure arrives). */
  loading?: boolean;
  /** Upstream data is stale: shows "No data" and this warning line instead of a figure (never a blank or a zero). */
  stale?: ReactNode;
  /** Makes the whole tile a button, with a light that follows the pointer. */
  onClick?: () => void;
  /** Tier tint for the corner light (node views). */
  tier?: 'cumulus' | 'nimbus' | 'stratus';
  className?: string;
}

/**
 * A stat tile: label, a large tabular figure with an optional unit, a delta, a caption and a sparkline
 * slot. The figure scales with the tile's width (container units), and a tile always reserves its
 * delta and caption row so a loading tile and a loaded one are the same size.
 */
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
  const follow = useSpotlight<HTMLButtonElement>();
  const unknown = !loading && !stale && isUnknownValue(value);
  const common = {
    className: cx('ui-stat', onClick && !hero && 'ui-spot', className),
    'data-hero': hero || undefined,
    'data-spark': spark ? '' : undefined,
    'data-state': loading ? 'loading' : stale ? 'stale' : undefined,
    'data-tier': tier,
    'aria-busy': loading || undefined,
  };
  const body = (
    <>
      <span className="ui-stat__label">{label}</span>
      {loading ? (
        <>
          <Skeleton className="ui-stat__skel-value" w="64%" h="1em" />
          <span className="ui-stat__meta">
            <Skeleton w="42%" h={10} />
          </span>
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
          <span className="ui-stat__meta">
            {stale ? <span className="ui-stat__stale">{stale}</span> : null}
            {delta && !stale ? <span className="ui-stat__delta">{delta}</span> : null}
            {caption && !stale ? <span className="ui-stat__caption">{caption}</span> : null}
          </span>
        </>
      )}
      {spark && !loading ? <span className="ui-stat__spark">{spark}</span> : null}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        {...common}
        onClick={onClick}
        onPointerMove={(e: PointerEvent<HTMLButtonElement>) => follow(e)}
      >
        {body}
      </button>
    );
  }
  return <div {...common}>{body}</div>;
}
