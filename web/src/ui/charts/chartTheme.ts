// The chart's palette and type, read from the design tokens at mount. uPlot draws on a canvas, so
// it cannot use `var(--x)`: this resolves the tokens once per chart (the app is dark-only, so a
// theme never changes under a mounted chart) and hands uPlot concrete colour strings.

import { resolveColor, resolveProperty } from './color';

export interface ChartTheme {
  /** Hairline gridlines (`--viz-grid`). */
  grid: string;
  /** Axis lines (`--viz-axis`), kept for charts that draw a baseline. */
  axis: string;
  /** Axis labels (`--viz-label`, which is `--text-3`). */
  label: string;
  /** Primary text, for direct labels. */
  text1: string;
  /** The card behind the chart: the colour of the 2 px ring around dots (`--ui-ts-surface`, default `--ink-1`). */
  surface: string;
  /** Canvas font shorthand for axis labels: Plex Mono at `--fs-2xs`. */
  font: string;
  /** Peak opacity of the area wash at the line (twice `--viz-area-alpha`). */
  areaAlpha: number;
}

/** Reads the chart theme from the tokens as seen from `host`. */
export function readChartTheme(host: HTMLElement): ChartTheme {
  const styles = getComputedStyle(host);
  const family = styles.getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace';
  const alpha = Number.parseFloat(styles.getPropertyValue('--viz-area-alpha'));
  const size = resolveProperty(host, 'fontSize', 'var(--fs-2xs)');
  return {
    grid: resolveColor(host, 'var(--viz-grid)'),
    axis: resolveColor(host, 'var(--viz-axis)'),
    label: resolveColor(host, 'var(--viz-label)'),
    text1: resolveColor(host, 'var(--text-1)'),
    surface: resolveColor(host, 'var(--ui-ts-surface, var(--ink-1))'),
    font: `${size} ${family}`,
    areaAlpha: Math.min(0.5, (Number.isFinite(alpha) ? alpha : 0.12) * 2.2),
  };
}
