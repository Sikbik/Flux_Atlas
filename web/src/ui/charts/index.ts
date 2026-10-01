// Charts (K1): Sparkline, TimeSeries (lazy, uPlot in its own chunk), BarList, ShareBar, Meter.
// `TimeSeriesImpl` is deliberately not exported: importing the kit must never pull uplot into the
// importer's chunk, so only the small lazy wrapper in TimeSeries.tsx is public.
export { BarList, type BarListItem, type BarListProps } from './BarList';
export { Meter, type MeterProps, type MeterTone, type MeterZone } from './Meter';
export { ShareBar, type ShareBarProps, type ShareSegment } from './ShareBar';
export { Sparkline, type SparklineProps } from './Sparkline';
export { SPARK_PRESETS, type SparkForm } from './sparkline';
export { TimeSeries, type TimeSeriesProps, type TimeSeriesSeries } from './TimeSeries';
export { MAX_SERIES as TIME_SERIES_MAX } from './timeSeries';
