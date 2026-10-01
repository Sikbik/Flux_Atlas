// Where the chain's rules changed inside the window: a dotted hairline through the plot and its name. Both
// Chain charts draw it, so a cliff in difficulty at the change reads as the change and not as a glitch.
// The name sits beside the hairline, near the top or the bottom of the plot, wherever the chart's own line
// is not.

import { PON_ACTIVATION_HEIGHT } from '../../explorer/lib/emission';
import type { TargetChange } from '../lib/chain';
import { type Avoid, lineCrosses } from './avoid';
import type { PlotGeo } from './ChainPlot';

/** What the name needs beside the hairline: its width at 10.5 px mono, and a gap. */
const LABEL_W = 86;
const GAP = 7;

export interface Placement {
  /** True puts the name to the right of the hairline. */
  after: boolean;
  /** The text baseline. */
  y: number;
}

/** The side and height for a name at `x`: the first spot, nearest the top on the roomier side, no line crosses. */
export function placeLabel(geo: PlotGeo, x: number, avoid?: Avoid): Placement {
  const left = geo.plot.x;
  const right = geo.plot.x + geo.plot.w;
  const fitsAfter = right - x > LABEL_W + GAP;
  const fitsBefore = x - left > LABEL_W + GAP;
  const slots = [geo.plot.y + 24, geo.plot.y + geo.plot.h - 8];
  const sides = fitsAfter ? [true, false] : [false, true];
  for (const after of sides) {
    if (!(after ? fitsAfter : fitsBefore)) continue;
    for (const y of slots) {
      const x0 = after ? x + GAP : x - GAP - LABEL_W;
      const x1 = after ? x + GAP + LABEL_W : x - GAP;
      if (!lineCrosses(avoid, x0, x1, y - 14, y + 3)) return { after, y };
    }
  }
  return { after: fitsAfter, y: slots[0]! };
}

export function EraMarks({
  changes,
  geo,
  avoid,
}: {
  changes: readonly TargetChange[];
  geo: PlotGeo;
  avoid?: Avoid;
}) {
  return (
    <>
      {changes.map((c) => {
        const x = geo.x(c.ms);
        const label = c.height === PON_ACTIVATION_HEIGHT ? 'Proof of Node' : 'Target change';
        const { after, y } = placeLabel(geo, x, avoid);
        return (
          <g key={c.ms} className="cp-era">
            <line x1={x} x2={x} y1={geo.plot.y} y2={geo.plot.y + geo.plot.h} />
            <text x={after ? x + GAP : x - GAP} y={y} textAnchor={after ? 'start' : 'end'}>
              {label}
            </text>
          </g>
        );
      })}
    </>
  );
}
