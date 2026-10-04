// The hero of a hub: the one big figure of the window, chamfered at the hexagon angle with a lit rim like the kit's
// hero stat, a graphic of the thing it counts on the right, and a row of supporting figures under a hairline.

import { Children, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from 'react';
import { cx, Skeleton } from '../../ui';
import { balancedColumns } from './columns';
import './hub.css';

export interface HubHeroProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  /** What the figure counts, in sentence case ("Chain tip"). */
  label: ReactNode;
  /** The figure: an AnimatedNumber, or text. Unknown renders as the kit's Unknown, never a zero. */
  value: ReactNode;
  unit?: ReactNode;
  /** One line under the figure. */
  caption?: ReactNode;
  /** Chips at the top right (the live state). */
  aside?: ReactNode;
  /** The buttons under the caption. */
  actions?: ReactNode;
  /** The graphic at the right (folds under the figure in a narrow window). */
  visual?: ReactNode;
  /** The supporting figures: a `HubFigures`. */
  children?: ReactNode;
  loading?: boolean;
}

/** The hero slab. */
export function HubHero({
  label,
  value,
  unit,
  caption,
  aside,
  actions,
  visual,
  children,
  loading,
  className,
  ...rest
}: HubHeroProps) {
  return (
    <section
      className={cx('hub-hero', className)}
      data-visual={visual ? '' : undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      <div className="hub-hero__lead">
        <div className="hub-hero__top">
          <span className="hub-hero__label">{label}</span>
          {aside ? <span className="hub-hero__aside">{aside}</span> : null}
        </div>
        <div className="hub-hero__value">
          {loading ? (
            <Skeleton w="62%" h="1em" radius={8} />
          ) : (
            <>
              {value}
              {unit ? <span className="hub-hero__unit">{unit}</span> : null}
            </>
          )}
        </div>
        {caption ? <p className="hub-hero__caption">{caption}</p> : null}
        {actions ? <div className="hub-hero__actions">{actions}</div> : null}
      </div>
      {visual ? <div className="hub-hero__visual">{visual}</div> : null}
      {children ? <div className="hub-hero__figs">{children}</div> : null}
    </section>
  );
}

/**
 * The supporting figures of a hero, as a list of terms and values. The columns follow the hero's own width (a
 * container query) and are chosen by how many figures there are, so the last row is never one figure beside a hole.
 */
export function HubFigures({ className, style, children, ...rest }: ComponentPropsWithoutRef<'dl'>) {
  const n = Children.toArray(children).length;
  const columns = {
    '--figs-s': Math.max(1, Math.min(n, 2)),
    '--figs-m': balancedColumns(n, 3),
    '--figs-l': balancedColumns(n, 5),
  } as CSSProperties;
  return (
    <dl className={cx('hub-figs', className)} style={{ ...columns, ...style }} {...rest}>
      {children}
    </dl>
  );
}

export interface HubFigureProps {
  label: ReactNode;
  /** The figure; null or undefined renders Unknown, never a zero. */
  value?: ReactNode;
  unit?: ReactNode;
  /** A line of context or a Delta. */
  note?: ReactNode;
  loading?: boolean;
  className?: string;
}

/** One supporting figure of a hero. */
export function HubFigure({ label, value, unit, note, loading, className }: HubFigureProps) {
  const unknown = value === null || value === undefined;
  return (
    <div className={cx('hub-fig', className)}>
      <dt className="hub-fig__label">{label}</dt>
      <dd className="hub-fig__value">
        {loading ? (
          <Skeleton w="70%" h="1em" radius={6} />
        ) : unknown ? (
          <span className="ui-unknown">Unknown</span>
        ) : (
          <>
            {value}
            {unit ? <span className="hub-fig__unit">{unit}</span> : null}
          </>
        )}
      </dd>
      <dd className="hub-fig__note">{loading ? <Skeleton w="48%" h={10} /> : note}</dd>
    </div>
  );
}
