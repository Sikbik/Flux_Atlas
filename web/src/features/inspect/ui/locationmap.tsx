import type { ReactNode } from 'react';
import { Card, cx } from '../../../ui';
import { type MapPoint, MiniMap } from './map';
import './parts.css';

/** The strip at the bottom of the card where the place is named; the map fits the space above it. */
const CAPTION_BAND = 40;

/**
 * The picture of where a thing is: a dot-matrix piece of the planet fitted to its points, with the
 * place named in the corner. A node, a host, an app's constellation and an operator's fleet all use it,
 * so the inspectors read as one family. The kit has no map, so the map is local; the frame is a kit Card.
 */
export function LocationMap({
  points,
  links,
  minSpan = 13,
  world,
  label,
  caption,
  corner,
  cornerTitle,
  tier,
  height = 140,
  labels = false,
  className,
}: {
  points: readonly MapPoint[];
  links?: ReadonlyArray<readonly [number, number]> | 'chain';
  minSpan?: number;
  world?: boolean;
  /** Accessible name of the map. */
  label: string;
  /** The place, bottom left: a name and an optional second line. */
  caption?: ReactNode;
  /** Small mono text bottom right (coordinates, a count): one element per line. */
  corner?: ReactNode;
  cornerTitle?: string;
  /** Tints the light (`data-tier`); a lone point gets a quiet reticle. */
  tier?: string;
  height?: number;
  labels?: boolean;
  className?: string;
}) {
  return (
    <Card
      padding="none"
      className={cx('ix-loc', className)}
      data-tier={tier}
      data-empty={points.length === 0 || undefined}
      style={{ height }}
    >
      {points.length ? (
        <MiniMap
          className="ix-loc-map"
          height={height - CAPTION_BAND}
          points={points}
          links={links}
          minSpan={minSpan}
          world={world}
          labels={labels}
          label={label}
        />
      ) : (
        <div className="ix-loc-map ix-loc-lattice" aria-hidden="true" />
      )}
      {points.length === 1 ? <div className="ix-loc-reticle" aria-hidden="true" /> : null}
      <div className="ix-loc-veil" aria-hidden="true" />
      {caption || corner ? (
        <div className="ix-loc-in">
          <div className="ix-loc-place">{caption}</div>
          {corner ? (
            <div className="ix-loc-coord" title={cornerTitle}>
              {corner}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
