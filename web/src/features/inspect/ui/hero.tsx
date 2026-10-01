import type { ReactNode } from 'react';
import { cx } from './cx';
import { type MapPoint, MiniMap } from './map';

/**
 * The header card of an inspector: a dot-matrix map fitted to the subject, state chips over it and the
 * name below. Every inspector opens with one, so a node, a host, an app and an operator read as one
 * family. `tier` tints the light (`data-tier`); a lone point gets the quiet reticle.
 */
export function HeroCard({
  points,
  links,
  minSpan = 13,
  world,
  mapLabel,
  chips,
  title,
  sub,
  corner,
  cornerTitle,
  tier,
  height = 176,
  labels = false,
  className,
}: {
  points: readonly MapPoint[];
  links?: ReadonlyArray<readonly [number, number]> | 'chain';
  minSpan?: number;
  world?: boolean;
  mapLabel: string;
  chips?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  /** Small mono text in the bottom corner (coordinates, a count): one element per line. */
  corner?: ReactNode;
  cornerTitle?: string;
  tier?: string;
  height?: number;
  labels?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cx('ix-hero-card', className)}
      data-tier={tier}
      data-empty={points.length === 0 || undefined}
      style={{ height }}
    >
      {points.length ? (
        <MiniMap
          className="ix-hero-map"
          height={height}
          points={points}
          links={links}
          minSpan={minSpan}
          world={world}
          labels={labels}
          label={mapLabel}
        />
      ) : (
        <div className="ix-hero-map ix-hero-lattice" aria-hidden="true" />
      )}
      {points.length === 1 ? <div className="ix-hero-reticle" aria-hidden="true" /> : null}
      <div className="ix-hero-veil" aria-hidden="true" />
      <div className="ix-hero-in">
        <div className="ix-chips">{chips}</div>
        <div className="ix-hero-foot">
          <div className="ix-hero-place">
            <div className="ix-hero-city">{title}</div>
            {sub ? <div className="ix-hero-sub">{sub}</div> : null}
          </div>
          {corner ? (
            <div className="ix-hero-coord" title={cornerTitle}>
              {corner}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
