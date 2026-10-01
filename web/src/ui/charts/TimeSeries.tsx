// TimeSeries: the lazy front door. This file must never import `uplot` (statically or through
// TimeSeriesImpl): the charting library loads as its own chunk the first time a chart has data to
// draw, so importing the kit never grows the shell. Loading, empty and error states render here
// without loading the chunk at all.

import { ChartNoAxesCombined } from 'lucide-react';
import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  lazy,
  type ReactNode,
  type Ref,
  Suspense,
} from 'react';
import { cx } from '../internal/cx';
import { EmptyState } from '../states/EmptyState';
import { ErrorState } from '../states/ErrorState';
import { TimeSeriesSkeleton } from './TimeSeriesSkeleton';
import { rootProps, type SeriesInput, type YDomain } from './timeSeries';
import './TimeSeries.css';

/** One line of a TimeSeries: `{ key, label, values }`, plus an optional colour and value format. */
export type TimeSeriesSeries = SeriesInput;

/**
 * Props of a TimeSeries: the data and look, plus `className`, `style`, `ref` and the other `<div>`
 * attributes. The root reports `data-state` (`ready`, `loading`, `empty` or `error`) and
 * `data-refreshing`; the hover readout reports `data-open` and `data-state`; legend toggles report
 * `aria-pressed` and, while pressed, `data-pressed`.
 */
export interface TimeSeriesProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** Timestamps in unix milliseconds, ascending (the `t` column of the metrics API). */
  t: readonly number[];
  /**
   * One to six series, each with one value per timestamp (null is a gap). Colours are the
   * categorical slots `--viz-1` to `--viz-6` in array order, never cycled; a seventh series is
   * ignored (fold the tail into "Other" before passing it). Give tier series a `color` of
   * `var(--tier-cumulus-ink)` and friends.
   */
  series: readonly TimeSeriesSeries[];
  /** Plot height in px, axes included (default 220). The footer (legend, "Show data") sits below it. */
  height?: number;
  /** Fill under the lines; default true for a single series, false for several. */
  area?: boolean;
  /** Formats y axis ticks and, unless a series has its own `format`, tooltip and table values. */
  yFormat?: (value: number) => string;
  /** Formats a timestamp for the tooltip, the data table and the summary (default `2026-09-30 19:39 UTC`). */
  xFormat?: (ms: number) => string;
  /** Fixed y bounds `[min, max]`; `null` leaves a side automatic (`[0, null]` pins a zero baseline). */
  yDomain?: YDomain;
  /** Keep only the newest this many points (a rolling window for live append). */
  maxPoints?: number;
  /** Accessible name; a one-sentence summary of the data is generated when omitted. */
  label?: string;
  /** Show the skeleton (the chart's exact geometry) instead of the plot. */
  loading?: boolean;
  /** An error from the data query: shows a compact error state instead of the plot. */
  error?: unknown;
  /** Called by the error state's Retry button. */
  onRetry?: () => void;
  /** Data is reloading: the last chart stays in place, dimmed, with no skeleton and no layout jump. */
  refreshing?: boolean;
  /** One sentence under "No data for this range" saying what to do next. */
  emptyText?: ReactNode;
  /** Open the "Show data" table initially. */
  defaultShowData?: boolean;
  /** Ref to the root element. */
  ref?: Ref<HTMLDivElement>;
}

const Chart = lazy(() => import('./TimeSeriesImpl'));

/** True when at least one series has a finite value (short-circuits on the first). */
function hasData(t: readonly number[], series: readonly TimeSeriesSeries[]): boolean {
  if (t.length === 0) return false;
  for (const s of series)
    for (const v of s.values) if (typeof v === 'number' && Number.isFinite(v)) return true;
  return false;
}

/**
 * A time series chart: lines or a gradient area over UTC time, a hover crosshair with a glass
 * tooltip, a legend for two or more series (click isolates, shift-click toggles), keyboard reading
 * (arrow keys move the crosshair, announced politely), a "Show data" table and the honest
 * loading, empty and error states. uPlot loads lazily in its own chunk; callers need no Suspense.
 */
export function TimeSeries(props: TimeSeriesProps) {
  const { t, series, height = 220, loading, error, onRetry, emptyText, className, style } = props;
  const multi = series.length >= 2;
  const dom = rootProps(props);
  const root = (state: string, vars?: CSSProperties) => ({
    ...dom,
    className: cx('ui-ts', className),
    style: { ...vars, ...style },
    'data-state': state,
  });

  if (loading) {
    return (
      <div {...root('loading')} aria-busy="true">
        <TimeSeriesSkeleton height={height} legend={multi} />
      </div>
    );
  }
  if (error !== undefined && error !== null) {
    return (
      <div {...root('error', { '--ui-ts-h': `${height}px` } as CSSProperties)}>
        <ErrorState compact error={error} onRetry={onRetry} />
      </div>
    );
  }
  if (!hasData(t, series)) {
    return (
      <div {...root('empty', { '--ui-ts-h': `${height}px` } as CSSProperties)}>
        <div className="ui-ts__empty">
          <EmptyState compact role="status" icon={ChartNoAxesCombined} title="No data for this range">
            {emptyText}
          </EmptyState>
        </div>
      </div>
    );
  }
  return (
    <Suspense
      fallback={
        <div {...root('loading')} aria-busy="true">
          <TimeSeriesSkeleton height={height} legend={multi} />
        </div>
      }
    >
      <Chart {...props} />
    </Suspense>
  );
}
