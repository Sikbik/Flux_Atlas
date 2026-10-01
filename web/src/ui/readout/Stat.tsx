import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import { isUnknownValue, Unknown } from '../identity/Unknown';
import { cx } from '../internal/cx';
import { pressHandlers } from '../internal/press';
import { Skeleton } from '../states/Skeleton';
import './Stat.css';

/**
 * Props of a Stat: the tile's content, plus `className`, `style`, `ref` and the other `<div>` attributes.
 * The tile reports its state as `data-state` (`loading` or `stale`) and, as a button, a press as `data-pressed`.
 */
export interface StatProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'onClick'> {
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
  /** A sparkline (64 by 26 px, 22 px high works best) in the top right corner; the hero tile takes a larger one at the lower right. */
  spark?: ReactNode;
  /** The view's one hero figure: large light numerals, a lit rim and the hexagon chamfer (use once per view). */
  hero?: boolean;
  /** Show skeleton bars with the geometry of the loaded tile (no layout shift when the figure arrives). */
  loading?: boolean;
  /** Upstream data is stale: shows "No data" and this warning line instead of a figure (never a blank or a zero). */
  stale?: ReactNode;
  /** Makes the whole tile a button. */
  onClick?: () => void;
  /** Tier tint for the corner light (node views). */
  tier?: 'cumulus' | 'nimbus' | 'stratus';
  /** Ref to the tile element (a `div`, or a `button` when it has `onClick`). */
  ref?: Ref<HTMLElement>;
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
  ref,
  ...rest
}: StatProps) {
  const unknown = !loading && !stale && isUnknownValue(value);
  const common = {
    className: cx('ui-stat', className),
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
    const own = rest as ComponentPropsWithoutRef<'button'>;
    return (
      <button
        type="button"
        ref={ref as Ref<HTMLButtonElement>}
        {...own}
        {...common}
        onClick={onClick}
        {...pressHandlers(own)}
      >
        {body}
      </button>
    );
  }
  return (
    <div ref={ref as Ref<HTMLDivElement>} {...rest} {...common}>
      {body}
    </div>
  );
}
