import type { CSSProperties } from 'react';
import { cx } from '../internal/cx';
import { Skeleton } from '../states/Skeleton';
import './TimeSeries.css';

export interface TimeSeriesSkeletonProps {
  /** Plot height in px (axes included), the same number the chart will use. */
  height: number;
  /** Reserve the legend row of a multi-series chart. */
  legend?: boolean;
  /** Draw only the plot (the veil that fades out over a freshly drawn chart). */
  plotOnly?: boolean;
  className?: string;
}

const Y_STUBS = [0, 1, 2, 3];
const X_STUBS = [0, 1, 2, 3, 4];

/**
 * The loading shape of a TimeSeries: the plot, its hairlines, the axis label stubs, a faint area
 * silhouette and the footer row, with exactly the geometry of the loaded chart so nothing moves
 * when the data arrives (design 8.0: skeletons carry the geometry of the final state).
 */
export function TimeSeriesSkeleton({ height, legend, plotOnly, className }: TimeSeriesSkeletonProps) {
  return (
    <div
      className={cx('ui-ts__skel', className)}
      style={{ '--ui-ts-h': `${height}px` } as CSSProperties}
      aria-hidden="true"
    >
      <div className="ui-ts__skel-plot">
        <div className="ui-ts__skel-y">
          {Y_STUBS.map((i) => (
            <Skeleton key={i} w={28} h={8} />
          ))}
        </div>
        <div className="ui-ts__skel-field">
          {Y_STUBS.map((i) => (
            <i key={i} className="ui-ts__skel-line" />
          ))}
          <Skeleton className="ui-ts__skel-wave" radius={0} />
        </div>
        <div className="ui-ts__skel-x">
          {X_STUBS.map((i) => (
            <Skeleton key={i} w={32} h={8} />
          ))}
        </div>
      </div>
      {plotOnly ? null : (
        <div className="ui-ts__foot">
          {legend ? (
            <span className="ui-ts__skel-legend">
              <Skeleton w={72} h={10} />
              <Skeleton w={64} h={10} />
              <Skeleton w={80} h={10} />
            </span>
          ) : (
            <span />
          )}
          <Skeleton w={78} h={10} />
        </div>
      )}
    </div>
  );
}
