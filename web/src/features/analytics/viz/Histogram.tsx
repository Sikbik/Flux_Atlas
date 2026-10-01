// A column histogram: thin columns with a 4 px rounded data end, square at the baseline, hairline grid,
// a tooltip per column and keyboard focus on each. Bins can be selected (a click-through).

import { useId, useMemo, useRef, useState } from 'react';
import { compactTick, linear, niceTicks } from './scale';
import { useSize } from './useSize';
import './viz.css';

export interface HistBin {
  key: string;
  /** Short label for the x axis. */
  label: string;
  /** Longer label for the tooltip. */
  title: string;
  count: number;
  color?: string;
}

export interface HistogramProps {
  bins: readonly HistBin[];
  label: string;
  height?: number;
  selected?: string | null;
  onSelect?: (key: string) => void;
  yFormat?: (v: number) => string;
  /** Show every n-th x label (default fits the width). */
  labelEvery?: number;
  unit?: string;
}

const M = { left: 40, right: 8, top: 8, bottom: 24 };

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  if (h <= 0) return '';
  return `M${x} ${y + h}V${y + rr}Q${x} ${y} ${x + rr} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h}Z`;
}

export function Histogram({
  bins,
  label,
  height = 160,
  selected = null,
  onSelect,
  yFormat = (v) => String(Math.round(v)),
  labelEvery,
  unit = '',
}: HistogramProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { width } = useSize(ref);
  const [hot, setHot] = useState<number | null>(null);
  const tipId = useId();
  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = Math.max(10, height - M.top - M.bottom);
  const geo = useMemo(() => {
    const max = Math.max(1, ...bins.map((b) => b.count));
    const t = niceTicks(0, max, Math.max(2, Math.round(plotH / 44)));
    const y = linear([0, t.max], [M.top + plotH, M.top]);
    const band = plotW / Math.max(1, bins.length);
    return { y, ticks: t.ticks, band };
  }, [bins, plotH, plotW]);
  const every = labelEvery ?? Math.max(1, Math.ceil(bins.length / Math.max(2, Math.floor(plotW / 54))));
  const thick = Math.min(24, Math.max(3, geo.band - 2));
  const hotBin = hot === null ? null : bins[hot];
  return (
    <figure className="vz-fig" aria-label={label} style={{ margin: 0 }}>
      <div className="vz-chart" ref={ref} style={{ height }}>
        {width > 0 ? (
          <svg
            className="vz-svg"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-label={label}
          >
            <g className="vz-grid">
              {geo.ticks.map((v) => (
                <g key={v}>
                  <line x1={M.left} x2={M.left + plotW} y1={geo.y(v)} y2={geo.y(v)} />
                  <text x={M.left - 8} y={geo.y(v)} dy="0.32em" textAnchor="end">
                    {compactTick(v)}
                  </text>
                </g>
              ))}
            </g>
            <g className="vz-xaxis">
              {bins.map((b, i) =>
                i % every === 0 ? (
                  <text
                    key={b.key}
                    x={M.left + geo.band * i + geo.band / 2}
                    y={M.top + plotH + 16}
                    textAnchor="middle"
                  >
                    {b.label}
                  </text>
                ) : null,
              )}
            </g>
            <g>
              {bins.map((b, i) => {
                const cx = M.left + geo.band * i + geo.band / 2;
                const y = geo.y(b.count);
                const h = M.top + plotH - y;
                const dim = selected !== null && selected !== b.key;
                const props = onSelect
                  ? {
                      tabIndex: 0,
                      role: 'button' as const,
                      'aria-label': `${b.title}: ${yFormat(b.count)}${unit ? ` ${unit}` : ''}`,
                      'aria-pressed': selected === b.key,
                      onClick: () => onSelect(b.key),
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelect(b.key);
                        }
                      },
                    }
                  : {};
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: the group takes role="button" whenever the histogram is interactive
                  <g
                    key={b.key}
                    onPointerEnter={() => setHot(i)}
                    onPointerLeave={() => setHot((c) => (c === i ? null : c))}
                    onFocus={() => setHot(i)}
                    onBlur={() => setHot((c) => (c === i ? null : c))}
                    {...props}
                  >
                    <rect
                      className="vz-hist-hit"
                      x={M.left + geo.band * i}
                      y={M.top}
                      width={geo.band}
                      height={plotH}
                    />
                    <path
                      className="vz-hist-bar"
                      data-dim={dim || undefined}
                      d={roundedTop(cx - thick / 2, y, thick, h, 4)}
                      style={{ fill: hot === i ? 'var(--accent-300)' : (b.color ?? undefined) }}
                    />
                  </g>
                );
              })}
            </g>
          </svg>
        ) : null}
        {hotBin && hot !== null && width > 0 ? (
          <div
            id={tipId}
            className="vz-tip"
            data-side={M.left + geo.band * hot > width * 0.6 ? 'left' : 'right'}
            style={{ left: M.left + geo.band * hot + geo.band / 2, top: M.top }}
            role="presentation"
          >
            <div className="vz-tip-head">{hotBin.title}</div>
            <ul>
              <li>
                <span
                  className="vz-key"
                  style={{ ['--c' as string]: hotBin.color ?? 'var(--viz-1)' }}
                  aria-hidden="true"
                />
                <strong className="vz-tip-val tabular">{yFormat(hotBin.count)}</strong>
                <span className="vz-tip-name">{unit || 'count'}</span>
              </li>
            </ul>
          </div>
        ) : null}
      </div>
    </figure>
  );
}
