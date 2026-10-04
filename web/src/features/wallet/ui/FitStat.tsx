import type { CSSProperties } from 'react';
import { Stat, type StatProps } from '../../../ui';
import { figureEm } from '../lib/figure';

export interface FitStatProps extends StatProps {
  /** The figure as it will read ("85,347.00", "$13,432.18"), or null while there is none. The tile sizes it to fit. */
  fit: string | null;
}

/**
 * A stat tile that sizes its figure to its own width. The kit's tile scales the figure by the tile's width alone, which
 * suits a short number and runs past a narrow tile on a long one ("391,999.50 FLUX" in a 150 px tile on a phone). This
 * one also knows how long the figure is: the style is in `wallet.css` (`[data-fit]`).
 */
export function FitStat({ fit, style, ...rest }: FitStatProps) {
  const sized = fit === null ? style : ({ ...style, '--wl-em': figureEm(fit).toFixed(3) } as CSSProperties);
  return <Stat data-fit={fit === null ? undefined : ''} style={sized} {...rest} />;
}
