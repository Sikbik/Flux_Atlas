// A flat dot-matrix world map with site markers. The land is a lazily rasterized grid of round dots
// (one <path> of zero-length round-capped segments, so thousands of dots cost one element); markers
// are real buttons when the map is interactive, sized by weight, and light up on hover and focus.

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { type LandDots, loadLandDots, MAP_LAT_MAX, MAP_LAT_MIN } from './land';
import { useSize } from './useSize';
import './viz.css';

export interface MapSite {
  key: string;
  lon: number;
  lat: number;
  /** Drives the marker area. */
  weight: number;
  label: string;
  /** Quiet text for the tooltip (a country, a count). */
  detail?: ReactNode;
  color?: string;
}

export interface DotMapProps {
  sites: readonly MapSite[];
  label: string;
  selected?: string | null;
  onSelect?: (key: string) => void;
  /** Largest marker radius in px at the reference width (1000 px). */
  maxRadius?: number;
  /** Formats the weight in the tooltip. */
  weightFormat?: (w: number) => string;
  weightUnit?: string;
}

const LON_SPAN = 360;
const LAT_SPAN = MAP_LAT_MAX - MAP_LAT_MIN;
const ASPECT = LON_SPAN / LAT_SPAN;

export function DotMap({
  sites,
  label,
  selected = null,
  onSelect,
  maxRadius = 9,
  weightFormat = (w) => String(Math.round(w)),
  weightUnit = '',
}: DotMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { width } = useSize(ref);
  const [land, setLand] = useState<LandDots | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadLandDots().then(
      (l) => live && setLand(l),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  const height = Math.round(width / ASPECT);
  const sx = width / LON_SPAN;
  const sy = height / LAT_SPAN;
  const px = (lon: number) => (lon + 180) * sx;
  const py = (lat: number) => (MAP_LAT_MAX - lat) * sy;
  const landPath = useMemo(() => {
    if (!land || sx <= 0) return '';
    const parts: string[] = [];
    const a = land.lonLat;
    for (let i = 0; i < a.length; i += 2) {
      const x = (a[i]! + 180) * sx;
      const y = (MAP_LAT_MAX - a[i + 1]!) * sy;
      parts.push(`M${x.toFixed(1)} ${y.toFixed(1)}h0`);
    }
    return parts.join('');
  }, [land, sx, sy]);
  const dot = Math.max(1.6, land ? land.cell * Math.min(sx, sy) * 0.46 : 2);
  const max = useMemo(() => Math.max(1, ...sites.map((s) => s.weight)), [sites]);
  const scale = width / 1000;
  const ordered = useMemo(() => [...sites].sort((a, b) => b.weight - a.weight), [sites]);
  const hotSite = hot ? sites.find((s) => s.key === hot) : undefined;
  return (
    <div className="vz-map-wrap" ref={ref} style={{ height: height || undefined, minHeight: 80 }}>
      {width > 0 ? (
        <svg
          className="vz-map"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-label={label}
        >
          <path className="vz-map-land" d={landPath} strokeWidth={dot} data-ready={land ? '' : undefined} />
          {[...ordered].reverse().map((s) => {
            const r = Math.max(3, Math.sqrt(s.weight / max) * maxRadius * Math.max(0.6, scale));
            const props = onSelect
              ? {
                  tabIndex: 0,
                  role: 'button' as const,
                  'aria-label': `${s.label}: ${weightFormat(s.weight)}${weightUnit ? ` ${weightUnit}` : ''}`,
                  'aria-pressed': selected === s.key,
                  onClick: () => onSelect(s.key),
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(s.key);
                    }
                  },
                }
              : {};
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: the group takes role="button" whenever the map is interactive
              <g
                key={s.key}
                onPointerEnter={() => setHot(s.key)}
                onPointerLeave={() => setHot((c) => (c === s.key ? null : c))}
                onFocus={() => setHot(s.key)}
                onBlur={() => setHot((c) => (c === s.key ? null : c))}
                {...props}
              >
                <circle className="vz-map-hit" cx={px(s.lon)} cy={py(s.lat)} r={Math.max(r + 4, 10)} />
                <circle
                  className="vz-map-halo"
                  cx={px(s.lon)}
                  cy={py(s.lat)}
                  r={r * 1.9}
                  style={{ ['--c' as string]: s.color }}
                  data-on={selected === s.key || hot === s.key || undefined}
                />
                <circle
                  className="vz-map-site"
                  cx={px(s.lon)}
                  cy={py(s.lat)}
                  r={r}
                  style={{ ['--c' as string]: s.color }}
                  data-hot={selected === s.key || hot === s.key || undefined}
                  data-dim={(selected && selected !== s.key) || undefined}
                />
              </g>
            );
          })}
        </svg>
      ) : null}
      {hotSite && width > 0 ? (
        <div
          className="vz-tip"
          data-side={px(hotSite.lon) > width * 0.62 ? 'left' : 'right'}
          style={{ left: px(hotSite.lon), top: Math.max(4, py(hotSite.lat) - 24) }}
          role="presentation"
        >
          <div className="vz-tip-head">{hotSite.label}</div>
          <ul>
            <li>
              <span
                className="vz-key"
                style={{ ['--c' as string]: hotSite.color ?? 'var(--viz-1)' }}
                aria-hidden="true"
              />
              <strong className="vz-tip-val tabular">{weightFormat(hotSite.weight)}</strong>
              <span className="vz-tip-name">{weightUnit || 'weight'}</span>
            </li>
            {hotSite.detail ? (
              <li>
                <span className="vz-tip-name">{hotSite.detail}</span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
