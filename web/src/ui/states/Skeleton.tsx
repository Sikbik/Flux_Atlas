import type { ComponentPropsWithRef, CSSProperties } from 'react';
import { cx } from '../internal/cx';
import './Skeleton.css';

export interface SkeletonProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  /** Width: px number or any CSS length (default 100%). */
  w?: number | string;
  /** Height: px number or any CSS length (default 12px). */
  h?: number | string;
  /** Corner radius: px number or any CSS length (default the small radius token). */
  radius?: number | string;
  /** Draw a circle of width `w` (height follows). */
  circle?: boolean;
}

const len = (v: number | string | undefined): string | undefined =>
  v === undefined ? undefined : typeof v === 'number' ? `${v}px` : v;

/** A shimmering placeholder block with the geometry of the content it stands for (never a spinner). */
export function Skeleton({ w, h, radius, circle, className, style, ...rest }: SkeletonProps) {
  const css: CSSProperties = {
    ...(w !== undefined ? { width: len(w) } : null),
    ...(circle ? { height: len(w ?? h), borderRadius: '50%' } : null),
    ...(!circle && h !== undefined ? { height: len(h) } : null),
    ...(!circle && radius !== undefined ? { borderRadius: len(radius) } : null),
    ...style,
  };
  return <span aria-hidden="true" className={cx('ui-skeleton', className)} style={css} {...rest} />;
}

export interface SkeletonTextProps {
  /** Number of lines (default 3). */
  lines?: number;
  /** Width of the last line (default 60%). */
  lastWidth?: string;
  /** Line height in px (default 12). */
  lineHeight?: number;
  className?: string;
}

/** Skeleton lines for a paragraph; the last one is shorter. */
export function SkeletonText({
  lines = 3,
  lastWidth = '60%',
  lineHeight = 12,
  className,
}: SkeletonTextProps) {
  return (
    <span aria-hidden="true" className={cx('ui-skeleton-text', className)}>
      {Array.from({ length: lines }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder lines never reorder
        <Skeleton key={i} h={lineHeight} w={i === lines - 1 && lines > 1 ? lastWidth : '100%'} />
      ))}
    </span>
  );
}
