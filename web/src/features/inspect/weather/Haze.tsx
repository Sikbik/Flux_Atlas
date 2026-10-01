import { type CSSProperties, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { GlobeLabel } from '../../../globe';
import { formatInt } from '../../../lib/format';
import type { Hotspot } from '../derive/weather';
import './weather.css';

/** The most glows drawn at once: the worst few, so the globe stays readable. */
export const HAZE_LIMIT = 8;

/** The layer every globe overlay lives in; the shell mounts it once, under the page and the windows. */
function useOverlayRoot(): HTMLElement | null {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setRoot(document.querySelector<HTMLElement>('.globe-overlay'));
  }, []);
  return root;
}

/** Diameter of a glow in px: it grows with the number of affected nodes, within bounds. */
export const hazeSize = (bad: number): number =>
  Math.round(Math.min(168, 44 + Math.sqrt(Math.max(0, bad)) * 22));

/**
 * A soft glow on the globe where trouble gathers (a hotspot): orange for an unsettled place, red for a
 * storm, sized by how many nodes are affected. The glows ride the planet through the globe's anchor
 * system (one position write per frame, no React render), fade at the limb and hide behind the planet.
 * They are decoration for the sighted: the list beside them says the same in words.
 */
export function Haze({ spots }: { spots: readonly Hotspot[] }) {
  const root = useOverlayRoot();
  if (!root || spots.length === 0) return null;
  return createPortal(
    spots.slice(0, HAZE_LIMIT).map((h) => (
      <GlobeLabel
        key={h.key}
        anchor={{ kind: 'world', lat: h.lat, lon: h.lon }}
        className="ix-haze"
        options={{ fade: true }}
      >
        <span
          className="ix-haze-disc"
          data-level={h.level}
          style={{ '--ix-haze': `${hazeSize(h.bad)}px` } as CSSProperties}
          aria-hidden="true"
        >
          <span className="ix-haze-n">{formatInt(h.bad)}</span>
        </span>
      </GlobeLabel>
    )),
    root,
  );
}
