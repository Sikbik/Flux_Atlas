// The nodes by tier as a honeycomb: a hundred hexagons, one for each percent of the network, filled tier by tier in
// the tier colours (and nothing else wears them). The legend beside it is the same facts as text. Hovering a tier in
// the legend lights its cells and dims the rest.

import { type CSSProperties, useMemo, useState } from 'react';
import type { TierCounts } from '../../../api/generated/TierCounts';
import { formatInt } from '../../../lib/format';
import { TierGlyph } from '../../../ui';
import { shareText } from '../../analytics/lib/concentration';
import { cellOwners, hexGrid } from './lib/hex';
import { tierSlices, tierSummary } from './lib/tiers';
import './nodes.css';

const COLS = 10;
const ROWS = 10;
const GRID = hexGrid(COLS, ROWS, 11);

const NONE: Pick<TierCounts, 'cumulus' | 'nimbus' | 'stratus' | 'total'> = {
  cumulus: 0,
  nimbus: 0,
  stratus: 0,
  total: 0,
};

export function TierGraphic({ counts }: { counts: TierCounts | null | undefined }) {
  const [hot, setHot] = useState<string | null>(null);
  const { slices, total } = useMemo(() => tierSlices(counts ?? NONE, COLS * ROWS), [counts]);
  const owners = useMemo(() => cellOwners(slices), [slices]);
  const known = counts !== null && counts !== undefined && total > 0;

  return (
    <div className="nd-tiers">
      <div className="nd-tiers__grid" onPointerLeave={() => setHot(null)}>
        <figure className="nd-tiers__fig">
          <svg
            className="nd-tiers__svg"
            viewBox={`0 0 ${GRID.width.toFixed(2)} ${GRID.height.toFixed(2)}`}
            role="img"
            aria-label={
              known ? `Nodes by tier, one hexagon for each percent. ${tierSummary(slices)}.` : 'Nodes by tier'
            }
          >
            {GRID.cells.map((c) => {
              const owner = owners[c.index];
              return (
                <polygon
                  key={c.index}
                  className="nd-hex"
                  points={c.points}
                  data-tier={owner ?? 'empty'}
                  data-dim={(hot !== null && owner !== hot) || undefined}
                  style={{ '--i': c.index } as CSSProperties}
                />
              );
            })}
          </svg>
          <figcaption className="nd-tiers__cap">One hexagon for each percent of the nodes</figcaption>
        </figure>

        <ul className="nd-tiers__legend" aria-label="Nodes by tier">
          {slices.map((s) => (
            <li
              key={s.id}
              className="nd-tier"
              data-tier={s.id}
              data-hot={hot === s.id || undefined}
              onPointerEnter={() => setHot(s.id)}
            >
              <TierGlyph tier={s.id} size={18} className="nd-tier__glyph" />
              <span className="nd-tier__name">{s.label}</span>
              <span className="nd-tier__count">{known ? formatInt(s.count) : ''}</span>
              <span className="nd-tier__share">{known ? shareText(s.share) : ''}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
