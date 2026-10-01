import type { ComponentPropsWithRef, CSSProperties } from 'react';
import { cx } from '../internal/cx';
import './StatGrid.css';

export interface StatGridProps extends ComponentPropsWithRef<'div'> {
  /** Minimum tile width in px before the grid wraps to fewer columns (default 140). */
  min?: number;
  /** Fix the column count instead of fitting as many tiles as the width allows. */
  columns?: number;
}

/** A responsive grid for stat tiles: as many columns as fit, never narrower than `min`, equal widths. */
export function StatGrid({ min = 140, columns, className, style, ...rest }: StatGridProps) {
  const css = {
    ...style,
    '--ui-stat-min': `${min}px`,
    ...(columns ? { '--ui-stat-cols': String(columns) } : null),
  } as CSSProperties;
  return (
    <div
      className={cx('ui-stat-grid', className)}
      data-fixed={columns ? '' : undefined}
      style={css}
      {...rest}
    />
  );
}
